"""Single-GPU sequential job execution with durable queue state."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from config import CACHE_DIR, DATA_ROOT, SCENE_THRESHOLD

logger = logging.getLogger(__name__)

JOBS_FILE = CACHE_DIR / "jobs.json"
MAX_TERMINAL_JOBS = 200
JOB_TIMEOUT_SECONDS = float(os.environ.get("NUWA_JOB_TIMEOUT", 30 * 60))


class JobCancelledError(Exception):
    """Raised inside a running job when a cancel request has been observed."""


class JobQueue:
    """In-process job queue. Jobs run sequentially and survive Worker restarts."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._current: str | None = None
        self._thread: threading.Thread | None = None
        self._watchdog: threading.Thread | None = None

    def submit(self, payload: dict) -> str:
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._jobs[job_id] = {
                "status": "queued",
                "progress": 0,
                "payload": payload,
                "result": None,
                "error": None,
                "created_at": time.time(),
            }
            self._persist()
        self._maybe_start()
        logger.info("Job %s queued (queue=%d)", job_id, self.size())
        return job_id

    def get_status(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job is not None else None

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return False
            if job["status"] == "queued":
                job["status"] = "cancelled"
                self._prune_terminal_jobs()
                self._persist()
                return True
            if job["status"] == "processing":
                # Request cooperative cancellation: the running pipeline observes
                # the flag at its next progress callback and aborts.
                job["cancel_requested"] = True
                job["error"] = "Cancel requested"
                self._persist()
                return True
        return False

    def _cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            return bool(self._jobs.get(job_id, {}).get("cancel_requested"))

    def size(self) -> int:
        with self._lock:
            return sum(
                1
                for job in self._jobs.values()
                if job.get("status") in {"queued", "processing"}
            )

    def restore(self) -> None:
        """Restore queued jobs, re-queue interrupted work, and retain results."""
        if not JOBS_FILE.exists():
            return
        try:
            restored_queued = False
            with self._lock:
                saved = json.loads(JOBS_FILE.read_text(encoding="utf-8"))
                if not isinstance(saved, dict):
                    raise ValueError("Persisted jobs must be a JSON object")
                for job_id, job in saved.items():
                    if not isinstance(job, dict):
                        continue
                    if job.get("status") == "processing":
                        job["status"] = "queued"
                        job["error"] = "Worker restarted; job re-queued"
                        job.pop("cancel_requested", None)
                    if job.get("status") in {"queued", "completed", "failed", "cancelled"}:
                        self._jobs[job_id] = job
                        restored_queued = restored_queued or job.get("status") == "queued"
                self._prune_terminal_jobs()
                self._persist()
                logger.info("Restored %d jobs from disk", len(self._jobs))
            if restored_queued:
                self._maybe_start()
        except Exception:
            logger.exception("Failed to restore jobs")

    def _persist(self) -> None:
        try:
            JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
            temp_file = JOBS_FILE.with_suffix(".tmp")
            temp_file.write_text(
                json.dumps(self._jobs, indent=2, default=str),
                encoding="utf-8",
            )
            temp_file.replace(JOBS_FILE)
        except Exception:
            logger.exception("Failed to persist jobs")

    def _maybe_start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
            if not self._watchdog or not self._watchdog.is_alive():
                self._watchdog = threading.Thread(target=self._watchdog_loop, daemon=True)
                self._watchdog.start()

    def _prune_terminal_jobs(self) -> None:
        terminal = [
            (job_id, job)
            for job_id, job in self._jobs.items()
            if job.get("status") in {"completed", "failed", "cancelled"}
        ]
        terminal.sort(
            key=lambda item: float(item[1].get("created_at", 0)),
            reverse=True,
        )
        for job_id, _ in terminal[MAX_TERMINAL_JOBS:]:
            self._jobs.pop(job_id, None)

    def _run_loop(self) -> None:
        while True:
            job_id, payload = self._next_queued()
            if job_id is None:
                time.sleep(1)
                continue

            self._current = job_id
            with self._lock:
                self._jobs[job_id]["status"] = "processing"
                self._jobs[job_id]["progress"] = 0
                self._jobs[job_id]["started_at"] = time.time()
                self._jobs[job_id].pop("cancel_requested", None)
                self._persist()

            try:
                result = self._execute(payload, job_id)
                with self._lock:
                    self._jobs[job_id]["status"] = "completed"
                    self._jobs[job_id]["progress"] = 100
                    self._jobs[job_id]["result"] = result
                    self._jobs[job_id]["error"] = None
                    self._prune_terminal_jobs()
                    self._persist()
            except JobCancelledError:
                logger.info("Job %s cancelled by user request", job_id)
                with self._lock:
                    self._jobs[job_id]["status"] = "cancelled"
                    self._jobs[job_id]["error"] = "Cancelled by user"
                    self._prune_terminal_jobs()
                    self._persist()
            except Exception as exc:
                logger.exception("Job %s failed", job_id)
                with self._lock:
                    self._jobs[job_id]["status"] = "failed"
                    self._jobs[job_id]["error"] = str(exc)
                    self._prune_terminal_jobs()
                    self._persist()
            finally:
                self._current = None

    def _watchdog_loop(self) -> None:
        """Mark a hung job as failed once it exceeds the configured timeout."""
        while True:
            time.sleep(10)
            with self._lock:
                current = self._current
                if current is None:
                    continue
                job = self._jobs.get(current)
                if not job or job.get("status") != "processing":
                    continue
                started_at = float(job.get("started_at", 0) or 0)
                if started_at > 0 and time.time() - started_at > JOB_TIMEOUT_SECONDS:
                    job["cancel_requested"] = True
                    job["error"] = f"Job timed out after {int(JOB_TIMEOUT_SECONDS)}s"
                    self._persist()
                    logger.warning("Job %s exceeded %ss timeout — requesting cancellation", current, JOB_TIMEOUT_SECONDS)

    def _next_queued(self) -> tuple[str | None, dict | None]:
        with self._lock:
            for job_id, job in self._jobs.items():
                if job["status"] == "queued":
                    return job_id, job["payload"]
        return None, None

    def _check_cancel(self, job_id: str) -> None:
        if self._cancel_requested(job_id):
            raise JobCancelledError()

    def _execute(self, payload: dict, job_id: str) -> dict:
        video_path = Path(payload["video_path"]).expanduser().resolve()
        data_root = Path(DATA_ROOT).expanduser().resolve()
        if not str(video_path).startswith(str(data_root) + os.sep) and video_path != data_root:
            raise ValueError("video_path is outside the configured data directory")
        video_path = str(video_path)
        options = payload.get("options", {})
        mode = options.get("mode", "annotate")

        if mode == "person_analysis":
            from services.person_analysis import run_person_analysis

            with self._lock:
                if job_id in self._jobs:
                    self._jobs[job_id]["progress"] = 10
                    self._jobs[job_id]["progressDetail"] = "Extracting selected person"
            self._check_cancel(job_id)
            result = run_person_analysis(
                video_path=video_path,
                timestamp=float(payload["segment_start"]),
                bbox=options.get("bbox", {}),
                image_width=float(options.get("image_width", 0)),
                image_height=float(options.get("image_height", 0)),
            )
            self._check_cancel(job_id)
            with self._lock:
                if job_id in self._jobs:
                    self._jobs[job_id]["progress"] = 95
                    self._jobs[job_id]["progressDetail"] = "Person suggestion ready"
            return result

        if mode == "scene_detect":
            from pipeline import run_scene_detection

            threshold = options.get("scene_threshold", SCENE_THRESHOLD)
            logger.info("Running scene detection for %s (threshold=%.2f)", video_path, threshold)
            result = run_scene_detection(video_path, threshold=threshold)
            self._check_cancel(job_id)
            return result

        from pipeline import run_annotation_pipeline

        segment_start = float(payload["segment_start"])
        segment_end = float(payload["segment_end"])
        logger.info(
            "Running pipeline for %s [%.1fs-%.1fs]",
            video_path,
            segment_start,
            segment_end,
        )

        def _update_progress(phase: str, pct: int) -> None:
            self._check_cancel(job_id)
            with self._lock:
                if job_id in self._jobs:
                    self._jobs[job_id]["progress"] = pct
                    self._jobs[job_id]["progressDetail"] = phase

        return run_annotation_pipeline(
            video_path=video_path,
            segment_start=segment_start,
            segment_end=segment_end,
            options=options,
            progress_cb=_update_progress,
        )


job_queue = JobQueue()
