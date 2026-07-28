"""Single source of truth for the video annotation worker configuration."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path


def _env_bool(name: str, default: bool = True) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _detect_device() -> str:
    requested = os.environ.get("NUWA_DEVICE", "auto").strip().lower()
    if requested in {"cpu", "cuda", "mps"}:
        return requested
    if importlib.util.find_spec("torch") is None:
        return "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


# ── Paths ─────────────────────────────────────────────

WORKER_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = WORKER_ROOT.parent.parent
DATA_ROOT = Path(
    os.environ.get(
        "VIDEO_ANNOTATION_DATA_ROOT",
        PROJECT_ROOT / "data" / "video-annotations",
    )
).expanduser().resolve()
UPLOADS_DIR = DATA_ROOT / "uploads"
CACHE_DIR = DATA_ROOT / "cache"
EXPORTS_DIR = DATA_ROOT / "exports"
TEMP_DIR = DATA_ROOT / "temp"
TASKS_DIR = DATA_ROOT / "tasks"
MODEL_MANIFEST_FILE = Path(
    os.environ.get("NUWA_MODEL_MANIFEST", DATA_ROOT / "models-manifest.json")
).expanduser().resolve()
VIDEO_SEMANTIC_CONFIG_FILE = Path(
    os.environ.get(
        "NUWA_VIDEO_SEMANTIC_CONFIG",
        PROJECT_ROOT / "configs" / "video-semantic-config.json",
    )
).expanduser().resolve()

for directory in [UPLOADS_DIR, CACHE_DIR, EXPORTS_DIR, TEMP_DIR, TASKS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)


# ── Server and runtime ────────────────────────────────

WORKER_HOST = os.environ.get("WORKER_HOST", "127.0.0.1")
WORKER_PORT = _env_int("WORKER_PORT", 8765)
# The current queue remains deliberately sequential; this value is reported by
# doctor/models so a future provider manager can enable safe concurrency.
GPU_CONCURRENCY = _env_int("GPU_CONCURRENCY", 1)
DEVICE = _detect_device()

FFMPEG_PATH = os.environ.get("FFMPEG_PATH", "ffmpeg")
FFPROBE_PATH = os.environ.get("FFPROBE_PATH", "ffprobe")

SCENE_THRESHOLD = _env_float("SCENE_THRESHOLD", 0.4)
if SCENE_THRESHOLD > 1:
    SCENE_THRESHOLD = SCENE_THRESHOLD / 255.0
SCENE_THRESHOLD = min(1.0, max(0.0, SCENE_THRESHOLD))


# ── Providers and model references ───────────────────

YOLO_MODEL = os.environ.get("YOLO_MODEL", "yolo11n")
QWEN_MODEL = os.environ.get("QWEN_LOCAL_MODEL_PATH") or os.environ.get(
    "QWEN_LOCAL_MODEL", "Qwen/Qwen3-VL-2B-Instruct"
)
LOCATE_ANYTHING_MODEL = os.environ.get(
    "LOCATE_ANYTHING_MODEL", "nvidia/LocateAnything-3B"
)
TROCR_MODEL = os.environ.get("TROCR_MODEL", "microsoft/trocr-small-printed")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "openai/whisper-tiny")
DEPTH_ANYTHING_MODEL = os.environ.get(
    "DEPTH_MODEL", "depth-anything/Depth-Anything-V2-Small-hf"
)

QWEN_MODEL_REVISION = os.environ.get("QWEN_MODEL_REVISION", "main")
LOCATE_ANYTHING_REVISION = os.environ.get("LOCATE_ANYTHING_REVISION", "main")
TROCR_MODEL_REVISION = os.environ.get("TROCR_MODEL_REVISION", "main")
WHISPER_MODEL_REVISION = os.environ.get("WHISPER_MODEL_REVISION", "main")
DEPTH_MODEL_REVISION = os.environ.get("DEPTH_MODEL_REVISION", "main")

PROVIDER_ENABLED = {
    "yolo": _env_bool("NUWA_PROVIDER_YOLO", True),
    "tracker": _env_bool("NUWA_PROVIDER_TRACKER", True),
    "locate_anything": _env_bool("NUWA_PROVIDER_LOCATE_ANYTHING", True),
    "qwen_vl": _env_bool("NUWA_PROVIDER_QWEN_VL", True),
    "trocr": _env_bool("NUWA_PROVIDER_TROCR", True),
    "whisper": _env_bool("NUWA_PROVIDER_WHISPER", True),
    "depth_anything": _env_bool("NUWA_PROVIDER_DEPTH_ANYTHING", True),
}


# ── Inference defaults ────────────────────────────────

DEFAULT_SAMPLE_FPS = _env_float("SAMPLE_FPS", 0.5)
DEFAULT_TRACKING_SAMPLE_FPS = min(
    10.0,
    max(0.5, _env_float("TRACKING_SAMPLE_FPS", 3.0)),
)
TRACKING_FRAME_BATCH_SIZE = max(1, _env_int("TRACKING_FRAME_BATCH_SIZE", 4))
DEFAULT_MAX_FRAMES = _env_int("MAX_FRAMES", 8)
DEFAULT_MAX_NEW_TOKENS = _env_int("MAX_NEW_TOKENS", 900)
DEFAULT_MAX_PIXELS = _env_int("MAX_PIXELS", 256 * 256)
LOCATE_MAX_SIDE = _env_int("LOCATE_MAX_SIDE", 1024, minimum=256)
LOCATE_MAX_NEW_TOKENS = _env_int("LOCATE_MAX_NEW_TOKENS", 512, minimum=64)
LOCATE_GENERATION_MODE = os.environ.get(
    "LOCATE_GENERATION_MODE", "hybrid"
).strip().lower()
if LOCATE_GENERATION_MODE not in {"hybrid", "fast", "slow"}:
    raise ValueError(
        "LOCATE_GENERATION_MODE must be 'hybrid', 'fast', or 'slow'"
    )
LOCATE_CATEGORY_MODE = os.environ.get(
    "LOCATE_CATEGORY_MODE", "adaptive"
).strip().lower()
if LOCATE_CATEGORY_MODE not in {"adaptive", "full"}:
    raise ValueError(
        "LOCATE_CATEGORY_MODE must be 'adaptive' or 'full'"
    )
LOCATE_ADAPTIVE_MAX_CATEGORIES = _env_int(
    "LOCATE_ADAPTIVE_MAX_CATEGORIES", 18, minimum=8
)
LOCATE_ADAPTIVE_GENERATION_MODE = os.environ.get(
    "LOCATE_ADAPTIVE_GENERATION_MODE", "fast"
).strip().lower()
if LOCATE_ADAPTIVE_GENERATION_MODE not in {"fast", "hybrid"}:
    raise ValueError(
        "LOCATE_ADAPTIVE_GENERATION_MODE must be 'fast' or 'hybrid'"
    )
LOCATE_ADAPTIVE_MAX_NEW_TOKENS = _env_int(
    "LOCATE_ADAPTIVE_MAX_NEW_TOKENS", 256, minimum=64
)
DEFAULT_CONFIDENCE_THRESHOLD = _env_float("CONFIDENCE_THRESHOLD", 0.65)
DEFAULT_IOU_THRESHOLD = _env_float("IOU_THRESHOLD", 0.6)
TRACKER_BACKEND = os.environ.get("NUWA_TRACKER_BACKEND", "bytetrack").strip().lower()
if TRACKER_BACKEND not in {"bytetrack", "iou"}:
    raise ValueError("NUWA_TRACKER_BACKEND must be 'bytetrack' or 'iou'")
DEFAULT_TRACK_LOW_THRESHOLD = min(
    DEFAULT_CONFIDENCE_THRESHOLD,
    max(0.0, _env_float("TRACK_LOW_THRESHOLD", 0.1)),
)
DEFAULT_TRACK_HIGH_THRESHOLD = min(
    1.0,
    max(DEFAULT_TRACK_LOW_THRESHOLD, _env_float(
        "TRACK_HIGH_THRESHOLD",
        DEFAULT_CONFIDENCE_THRESHOLD,
    )),
)
DEFAULT_TRACK_MATCH_THRESHOLD = min(
    1.0,
    max(0.0, _env_float("TRACK_MATCH_THRESHOLD", 0.8)),
)
DEFAULT_TRACK_BUFFER = max(1, _env_int("TRACK_BUFFER", 30))

# Lightweight person ReID. The public ONNX model is cached by
# huggingface_hub and runs through OpenCV DNN on CPU, so it does not compete
# with Qwen or LocateAnything for GPU memory.
PERSON_REID_ENABLED = _env_bool("NUWA_PERSON_REID", True)
PERSON_REID_MODEL_PATH = os.environ.get("PERSON_REID_MODEL_PATH", "").strip()
PERSON_REID_REPO = os.environ.get("PERSON_REID_REPO", "opencv/opencv_zoo").strip()
PERSON_REID_FILENAME = os.environ.get(
    "PERSON_REID_FILENAME",
    "models/person_reid_youtureid/person_reid_youtu_2021nov.onnx",
).strip()
PERSON_REID_REVISION = os.environ.get(
    "PERSON_REID_REVISION",
    "d4938dfc9d4ec5d098bfa33e98b3f3345a236586",
).strip()
PERSON_REID_MATCH_THRESHOLD = min(
    1.0,
    max(0.0, _env_float("PERSON_REID_MATCH_THRESHOLD", 0.82)),
)
PERSON_REID_MAX_GAP_SECONDS = max(
    2.5,
    _env_float("PERSON_REID_MAX_GAP_SECONDS", 30.0),
)
