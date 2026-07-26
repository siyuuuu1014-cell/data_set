"""Hugging Face credential validation and enhanced-model provisioning.

Raw tokens are accepted only by the Worker administration endpoint, passed to
huggingface_hub for validation/persistence, and never included in responses.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any

from providers.registry import (
    PROVIDER_SPECS,
    deployment_mode,
    download_provider,
    has_hf_token,
    local_model_path,
    provider_status,
)

MODEL_ID = "locate_anything"
MODEL_REPO_ID = "nvidia/LocateAnything-3B"
MODEL_URL = f"https://huggingface.co/{MODEL_REPO_ID}"

_lock = threading.Lock()
_setup: dict[str, Any] = {
    "status": "idle",
    "phase": None,
    "error": None,
    "updatedAt": None,
}


def _now() -> int:
    return int(time.time())


def _set_setup(status: str, phase: str | None = None, error: str | None = None) -> None:
    with _lock:
        _setup.update(status=status, phase=phase, error=error, updatedAt=_now())


def _safe_error(error: Exception) -> str:
    message = str(error).strip().splitlines()[0]
    return message[:400] or error.__class__.__name__


def _is_access_error(error: Exception) -> bool:
    response = getattr(error, "response", None)
    return getattr(response, "status_code", None) in {401, 403}


def auth_summary(check_account: bool = True) -> dict[str, Any]:
    authenticated = has_hf_token()
    summary: dict[str, Any] = {
        "authenticated": authenticated,
        "source": "environment" if os.environ.get("HF_TOKEN") else ("cache" if authenticated else None),
        "username": None,
        "error": None,
    }
    if not authenticated or not check_account:
        return summary
    try:
        from huggingface_hub import get_token, whoami

        account = whoami(token=get_token())
        summary["username"] = account.get("name") or account.get("fullname")
    except Exception as error:
        summary["error"] = _safe_error(error)
    return summary


def setup_summary() -> dict[str, Any]:
    model = provider_status(MODEL_ID, check_model=True)
    resolved_path = local_model_path(MODEL_ID)
    with _lock:
        setup = dict(_setup)
    if model.status in {"ready", "loaded"}:
        setup.update(status="ready", phase="ready", error=None)
    elif model.status == "incompatible_dependency":
        setup.update(status="failed", phase="compatibility", error=model.reason)
    elif deployment_mode() == "standard" and setup["status"] not in {"checking_access", "downloading"}:
        setup.update(status="idle", phase=None, error=None)
    return {
        **setup,
        "model": model.model,
        "modelUrl": MODEL_URL,
        "providerStatus": model.status,
        "providerReason": model.reason,
        "cacheRoot": os.environ.get("HF_HOME") or str(Path.home() / ".cache" / "huggingface"),
        "localModelPath": resolved_path,
        "downloadRequired": resolved_path is None,
        "approximateDownloadGb": 7.2,
    }


def deployment_summary(check_account: bool = True) -> dict[str, Any]:
    return {
        "mode": deployment_mode(),
        "managedByEnvironment": bool(os.environ.get("NUWA_DEPLOYMENT_MODE")),
        "huggingFace": auth_summary(check_account=check_account),
        "enhancedSetup": setup_summary(),
    }


def _prepare_enhanced_sync() -> None:
    from huggingface_hub import HfApi, get_token

    token = get_token()
    if not token:
        _set_setup("auth_required", "authorization", "Hugging Face authorization is required")
        return

    _set_setup("checking_access", "access")
    try:
        HfApi().model_info(MODEL_REPO_ID, token=token)
    except Exception as error:
        if _is_access_error(error):
            _set_setup(
                "access_required",
                "access",
                "Accept the model terms on Hugging Face, then retry model preparation",
            )
        else:
            _set_setup("failed", "access", _safe_error(error))
        return

    _set_setup("downloading", "download")
    try:
        download_provider(MODEL_ID)
        _set_setup("ready", "ready")
    except Exception as error:
        _set_setup("failed", "download", _safe_error(error))


def start_enhanced_setup() -> dict[str, Any]:
    with _lock:
        if _setup["status"] in {"checking_access", "downloading"}:
            return dict(_setup)
        _setup.update(status="checking_access", phase="access", error=None, updatedAt=_now())
    threading.Thread(target=_prepare_enhanced_sync, name="nuwa-hf-model-setup", daemon=True).start()
    return setup_summary()


def authorize_with_token(token: str) -> dict[str, Any]:
    """Validate and persist a user token without returning it to the caller."""
    if os.environ.get("HF_TOKEN"):
        raise RuntimeError("HF_TOKEN is managed by the process environment; update it in the deployment secret manager")
    normalized = token.strip()
    if not normalized or len(normalized) > 512:
        raise ValueError("A valid Hugging Face token is required")

    from huggingface_hub import HfApi, login

    account = HfApi().whoami(token=normalized)
    try:
        login(token=normalized, add_to_git_credential=False, skip_if_logged_in=False)
    except TypeError:
        # Compatibility with older huggingface_hub releases supported by the worker.
        login(token=normalized, add_to_git_credential=False)
    return {
        "authenticated": True,
        "username": account.get("name") or account.get("fullname"),
        "setup": setup_summary(),
    }
