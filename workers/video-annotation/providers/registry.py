"""Provider capability registry, model cache inspection, and provisioning."""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import threading
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from config import (
    DATA_ROOT,
    DEPTH_ANYTHING_MODEL,
    DEPTH_MODEL_REVISION,
    DEVICE,
    LOCATE_ANYTHING_MODEL,
    LOCATE_ANYTHING_REVISION,
    MODEL_MANIFEST_FILE,
    PROVIDER_ENABLED,
    QWEN_MODEL,
    QWEN_MODEL_REVISION,
    WHISPER_MODEL,
    WHISPER_MODEL_REVISION,
    YOLO_MODEL,
)


DEPLOYMENT_CONFIG_FILE = DATA_ROOT / "deployment.json"
DEPLOYMENT_MODES = {"standard", "enhanced"}


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    factory: str
    modules: tuple[str, ...]
    profile: str
    model: str | None = None
    revision: str | None = None
    gated: bool = False
    approximate_vram_gb: float = 0.0
    download_patterns: tuple[str, ...] = ()


@dataclass
class ProviderStatus:
    id: str
    label: str
    enabled: bool
    status: str
    model: str | None
    revision: str | None
    device: str
    loaded: bool
    profile: str
    approximateVramGb: float
    missingDependencies: list[str]
    reason: str | None = None


PROVIDER_SPECS: dict[str, ProviderSpec] = {
    "yolo": ProviderSpec(
        "yolo", "YOLO11", "providers.detector.yolo11:YOLO11Detector",
        ("torch", "ultralytics", "numpy"), "detect", YOLO_MODEL,
        approximate_vram_gb=0.5,
    ),
    "tracker": ProviderSpec(
        "tracker", "IoU tracker", "providers.tracker.bytetrack:ByteTrackTracker",
        ("numpy",), "detect",
    ),
    "locate_anything": ProviderSpec(
        "locate_anything", "LocateAnything-3B",
        "providers.grounding.locate_anything:LocateAnythingGrounding",
        ("torch", "transformers", "accelerate", "timm", "PIL"), "grounding",
        LOCATE_ANYTHING_MODEL, LOCATE_ANYTHING_REVISION, True, 6.0,
        ("*.json", "*.py", "*.safetensors", "*.txt", "*.model", "*.tiktoken"),
    ),
    "qwen_vl": ProviderSpec(
        "qwen_vl", "Qwen3-VL", "providers.semantic.qwen_vl:QwenVLSemantic",
        ("torch", "transformers", "json_repair", "PIL"), "semantic",
        QWEN_MODEL, QWEN_MODEL_REVISION, False, 4.0,
    ),
    "trocr": ProviderSpec(
        "trocr", "RapidOCR", "providers.ocr.trocr:TrOCRProvider",
        ("rapidocr", "onnxruntime", "numpy"), "ocr",
    ),
    "whisper": ProviderSpec(
        "whisper", "Whisper", "providers.audio.whisper_stt:WhisperSTTProvider",
        ("torch", "transformers", "scipy"), "audio",
        WHISPER_MODEL, WHISPER_MODEL_REVISION, False, 1.0,
    ),
    "depth_anything": ProviderSpec(
        "depth_anything", "Depth Anything v2",
        "providers.depth.depth_anything:DepthAnythingEstimator",
        ("torch", "transformers", "PIL", "numpy"), "depth",
        DEPTH_ANYTHING_MODEL, DEPTH_MODEL_REVISION, False, 1.0,
    ),
}

PROFILE_PROVIDERS: dict[str, tuple[str, ...]] = {
    "base": (),
    "detect": ("yolo", "tracker"),
    "semantic": ("qwen_vl",),
    "grounding": ("locate_anything",),
    "ocr": ("trocr",),
    "audio": ("whisper",),
    "depth": ("depth_anything",),
    "full": tuple(PROVIDER_SPECS),
}

_loaded: set[str] = set()
_state_lock = threading.Lock()
_download_thread_lock = threading.Lock()
_DOWNLOAD_LOCK_FILE = DATA_ROOT / "model-download.lock"


def _load_manifest() -> dict[str, Any]:
    try:
        if MODEL_MANIFEST_FILE.exists():
            data = json.loads(MODEL_MANIFEST_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"version": 1, "models": {}}


def _write_manifest(manifest: dict[str, Any]) -> None:
    MODEL_MANIFEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_path = MODEL_MANIFEST_FILE.with_suffix(".tmp")
    temp_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    temp_path.replace(MODEL_MANIFEST_FILE)


def deployment_mode() -> str:
    """Return the deployment mode without making optional providers mandatory."""
    configured = os.environ.get("NUWA_DEPLOYMENT_MODE", "").strip().lower()
    if configured in DEPLOYMENT_MODES:
        return configured
    try:
        data = json.loads(DEPLOYMENT_CONFIG_FILE.read_text(encoding="utf-8"))
        mode = str(data.get("mode", "standard")).lower()
        if mode in DEPLOYMENT_MODES:
            return mode
    except (OSError, json.JSONDecodeError, AttributeError):
        pass
    return "standard"


def set_deployment_mode(mode: str) -> str:
    """Persist the deployment mode unless it is managed by the environment."""
    normalized = mode.strip().lower()
    if normalized not in DEPLOYMENT_MODES:
        raise ValueError(f"Unknown deployment mode: {mode}")
    if os.environ.get("NUWA_DEPLOYMENT_MODE"):
        raise RuntimeError("Deployment mode is managed by NUWA_DEPLOYMENT_MODE")
    DEPLOYMENT_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_path = DEPLOYMENT_CONFIG_FILE.with_suffix(".tmp")
    temp_path.write_text(json.dumps({"mode": normalized}, indent=2), encoding="utf-8")
    temp_path.replace(DEPLOYMENT_CONFIG_FILE)
    return normalized


def model_revision(provider_id: str) -> str | None:
    spec = PROVIDER_SPECS[provider_id]
    manifest_entry = _load_manifest().get("models", {}).get(provider_id, {})
    if manifest_entry.get("model") == spec.model:
        return manifest_entry.get("resolvedRevision") or spec.revision
    return spec.revision


def model_load_kwargs(provider_id: str, model_ref: str) -> dict[str, str]:
    if Path(model_ref).expanduser().exists():
        return {}
    revision = model_revision(provider_id)
    return {"revision": revision} if revision else {}


def is_provider_enabled(provider_id: str, options: dict[str, Any] | None = None) -> bool:
    if not PROVIDER_ENABLED.get(provider_id, True):
        return False
    if PROVIDER_SPECS[provider_id].gated and deployment_mode() != "enhanced":
        return False
    selected = (options or {}).get("providers")
    if selected is None:
        return True
    if isinstance(selected, list):
        return provider_id in selected
    if isinstance(selected, dict):
        return bool(selected.get(provider_id, True))
    return True


def create_provider(provider_id: str) -> Any:
    spec = PROVIDER_SPECS[provider_id]
    module_name, class_name = spec.factory.split(":", 1)
    module = importlib.import_module(module_name)
    return getattr(module, class_name)()


def mark_loaded(provider_id: str, loaded: bool) -> None:
    with _state_lock:
        if loaded:
            _loaded.add(provider_id)
        else:
            _loaded.discard(provider_id)


def loaded_provider_ids() -> list[str]:
    with _state_lock:
        return sorted(_loaded)


def _missing_modules(spec: ProviderSpec) -> list[str]:
    return [name for name in spec.modules if importlib.util.find_spec(name) is None]


def has_hf_token() -> bool:
    if os.environ.get("HF_TOKEN"):
        return True
    try:
        from huggingface_hub import get_token

        return bool(get_token())
    except Exception:
        return False


def _normalized_yolo_model(model: str) -> str:
    path = Path(model).expanduser()
    if path.suffix.lower() in {".pt", ".yaml", ".yml", ".onnx"}:
        return str(path)
    return f"{model}.pt"


def _resolve_local_model_path(spec: ProviderSpec) -> str | None:
    if not spec.model:
        return None
    manifest_entry = _load_manifest().get("models", {}).get(spec.id, {})
    manifest_path = manifest_entry.get("path")
    if manifest_entry.get("model") == spec.model and manifest_path:
        if Path(manifest_path).expanduser().exists():
            return str(Path(manifest_path).expanduser().resolve())
    if spec.id == "yolo":
        model_path = Path(_normalized_yolo_model(spec.model))
        return str(model_path.resolve()) if model_path.exists() else None
    local_path = Path(spec.model).expanduser()
    if local_path.exists():
        return str(local_path.resolve())
    if "/" not in spec.model or importlib.util.find_spec("huggingface_hub") is None:
        return None
    try:
        from huggingface_hub import snapshot_download

        resolved = snapshot_download(
            repo_id=spec.model,
            revision=model_revision(spec.id),
            local_files_only=True,
            allow_patterns=list(spec.download_patterns) or None,
        )
        return str(Path(resolved).resolve())
    except Exception:
        return None


def _local_model_ready(spec: ProviderSpec) -> bool:
    return not spec.model or _resolve_local_model_path(spec) is not None


def local_model_path(provider_id: str) -> str | None:
    return _resolve_local_model_path(PROVIDER_SPECS[provider_id])


@contextmanager
def _process_download_lock(timeout_seconds: float = 1800.0):
    """Serialize cache writes across Worker processes as well as threads."""
    _DOWNLOAD_LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _download_thread_lock, _DOWNLOAD_LOCK_FILE.open("a+b") as lock_file:
        if lock_file.tell() == 0:
            lock_file.write(b"0")
            lock_file.flush()
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                lock_file.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Timed out waiting for another model download to finish")
                time.sleep(0.5)
        try:
            yield
        finally:
            lock_file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def provider_status(provider_id: str, check_model: bool = True) -> ProviderStatus:
    spec = PROVIDER_SPECS[provider_id]
    enabled = PROVIDER_ENABLED.get(provider_id, True)
    missing = _missing_modules(spec)
    loaded = provider_id in loaded_provider_ids()
    status = "loaded" if loaded else "ready"
    reason: str | None = None

    if spec.gated and deployment_mode() != "enhanced":
        enabled = False
        status = "disabled"
        reason = "Available only in enhanced deployment mode"
    elif not enabled:
        status = "disabled"
        reason = "Disabled by NUWA_PROVIDER_* configuration"
    elif missing:
        status = "missing_dependency"
        reason = f"Missing Python dependencies: {', '.join(missing)}"
    elif check_model and spec.model and not _local_model_ready(spec):
        if spec.gated and not has_hf_token():
            status = "auth_required"
            reason = "Hugging Face authentication is required before downloading this gated model"
        else:
            status = "model_missing"
            reason = "Model is not available in the configured local cache"

    return ProviderStatus(
        id=spec.id,
        label=spec.label,
        enabled=enabled,
        status=status,
        model=spec.model,
        revision=model_revision(provider_id),
        device=DEVICE,
        loaded=loaded,
        profile=spec.profile,
        approximateVramGb=spec.approximate_vram_gb,
        missingDependencies=missing,
        reason=reason,
    )


def provider_statuses(check_models: bool = True) -> list[dict[str, Any]]:
    return [asdict(provider_status(provider_id, check_models)) for provider_id in PROVIDER_SPECS]


def providers_for_profile(profile: str) -> tuple[str, ...]:
    if profile not in PROFILE_PROVIDERS:
        raise ValueError(f"Unknown model profile: {profile}")
    return PROFILE_PROVIDERS[profile]


def download_provider(provider_id: str) -> dict[str, Any]:
    spec = PROVIDER_SPECS[provider_id]
    missing = _missing_modules(spec)
    if missing:
        raise RuntimeError(f"Missing dependencies for {provider_id}: {', '.join(missing)}")
    if not spec.model:
        return {"provider": provider_id, "status": "ready", "path": None}

    with _process_download_lock():
        existing_path = _resolve_local_model_path(spec)
        if existing_path:
            resolved_path = existing_path
            resolved_revision = model_revision(provider_id)
        elif spec.id == "yolo":
            model_ref = _normalized_yolo_model(spec.model)
            from ultralytics import YOLO

            model = YOLO(model_ref)
            del model
            resolved_path = str(Path(model_ref).resolve()) if Path(model_ref).exists() else model_ref
            resolved_revision = None
        else:
            if importlib.util.find_spec("huggingface_hub") is None:
                raise RuntimeError("huggingface-hub is required to download models")
            from huggingface_hub import snapshot_download

            resolved_path = snapshot_download(
                repo_id=spec.model,
                revision=spec.revision,
                allow_patterns=list(spec.download_patterns) or None,
            )
            path_parts = Path(resolved_path).parts
            resolved_revision = path_parts[-1] if "snapshots" in path_parts else spec.revision

        manifest = _load_manifest()
        manifest.setdefault("models", {})[provider_id] = {
            "model": spec.model,
            "requestedRevision": spec.revision,
            "resolvedRevision": resolved_revision,
            "path": resolved_path,
        }
        _write_manifest(manifest)
    return {
        "provider": provider_id,
        "status": "downloaded",
        "path": resolved_path,
        "resolvedRevision": resolved_revision,
    }
