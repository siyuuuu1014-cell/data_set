"""nuwa Video Annotation Worker — FastAPI application.

Listens on 127.0.0.1 only. Models are loaded lazily per-job.
"""

from __future__ import annotations

import logging
import os
import secrets
import asyncio
from contextlib import asynccontextmanager

from pydantic import BaseModel, Field, model_validator

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware


class JobSubmission(BaseModel):
    model_config = {"extra": "allow"}

    video_path: str
    segment_start: float = Field(default=0.0)
    segment_end: float = Field(default=0.0)
    options: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_segment_bounds(self) -> "JobSubmission":
        if self.segment_end < self.segment_start:
            raise ValueError("segment_end must be >= segment_start")
        return self

from config import WORKER_HOST, WORKER_PORT, DEVICE
from logging_utils import setup_logging
from providers.registry import loaded_provider_ids, provider_statuses, set_deployment_mode
from providers.semantic.remote_api import RemoteApiSemantic
from services.hf_auth import (
    authorize_with_token,
    deployment_summary,
    start_enhanced_setup,
)
from worker import job_queue

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger.info("Worker starting on %s:%s (device=%s)", WORKER_HOST, WORKER_PORT, DEVICE)

    # Restore interrupted jobs
    job_queue.restore()

    yield

    logger.info("Worker shutting down")


app = FastAPI(
    title="nuwa Video Annotation Worker",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_admin(request: Request) -> None:
    """Keep credential mutations local unless an internal shared secret is set."""
    client_host = request.client.host if request.client else ""
    if client_host in {"127.0.0.1", "::1", "localhost", "testclient"}:
        return
    expected = os.environ.get("NUWA_WORKER_ADMIN_TOKEN", "")
    provided = request.headers.get("x-nuwa-worker-admin", "")
    if expected and secrets.compare_digest(expected, provided):
        return
    raise HTTPException(status_code=403, detail="Worker administration is restricted")


# ── Health ────────────────────────────────────────────


@app.get("/health")
async def health():
    loaded = loaded_provider_ids()
    return {
        "status": "ok",
        "device": DEVICE,
        "queue_size": job_queue.size(),
        "modelsLoaded": loaded,
    }


@app.get("/models")
async def models():
    providers = provider_statuses(check_models=True)
    return {
        "device": DEVICE,
        "models": {provider["id"]: provider["status"] for provider in providers},
        "providers": providers,
        "modelsLoaded": loaded_provider_ids(),
    }


# ── Deployment and Hugging Face authorization ─────────────


@app.get("/deployment")
async def deployment():
    return deployment_summary(check_account=True)


@app.put("/deployment")
async def update_deployment(payload: dict, request: Request):
    _require_admin(request)
    try:
        mode = set_deployment_mode(str(payload.get("mode", "")))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {**deployment_summary(check_account=False), "mode": mode}


@app.post("/deployment/prepare")
async def prepare_deployment(request: Request):
    _require_admin(request)
    return start_enhanced_setup()


@app.post("/auth/huggingface/token")
async def authorize_huggingface(payload: dict, request: Request):
    _require_admin(request)
    try:
        return authorize_with_token(str(payload.get("token", "")))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        logger.warning("Hugging Face authorization failed: %s", error.__class__.__name__)
        raise HTTPException(status_code=401, detail="Hugging Face token validation failed") from error


@app.post("/semantic/test")
async def test_remote_semantic(payload: dict, request: Request):
    """Run a minimal vision request only when the user explicitly tests it."""
    _require_admin(request)
    provider = RemoteApiSemantic(payload)
    try:
        return await asyncio.to_thread(provider.test_connection)
    except Exception as error:
        logger.warning("Remote semantic connection test failed: %s", error)
        raise HTTPException(status_code=502, detail=str(error)) from error
    finally:
        provider.unload()


# ── Jobs ──────────────────────────────────────────────


@app.post("/jobs")
async def submit_job(payload: JobSubmission):
    """Submit an annotation job."""
    job_id = job_queue.submit(payload.model_dump())
    return {"jobId": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    status = job_queue.get_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": f"Job {job_id} not found"})
    return {
        "jobId": job_id,
        "status": status["status"],
        "progress": status.get("progress", 0),
        "progressDetail": status.get("progressDetail"),
        "result": status.get("result"),
        "error": status.get("error"),
    }


@app.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    ok = job_queue.cancel(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": f"Job {job_id} not found"})
    return {"jobId": job_id, "status": "cancelled"}


# ── Entry point ───────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "workers.video_annotation.app:app",
        host=WORKER_HOST,
        port=WORKER_PORT,
        reload=False,
    )
