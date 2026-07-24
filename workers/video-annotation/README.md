# Nuwa Video Annotation Worker

FastAPI worker for scene detection and optional GPU-backed video annotation providers. It listens on `127.0.0.1:8765` by default and keeps the existing full annotation pipeline enabled unless providers are explicitly disabled.

## Setup profiles

Run from the repository root:

```powershell
# Existing behavior: install every provider
.\scripts\setup-video-worker.ps1 -Profile full

# Smaller installations
.\scripts\setup-video-worker.ps1 -Profile base
.\scripts\setup-video-worker.ps1 -Profile detect
.\scripts\setup-video-worker.ps1 -Profile semantic

# Install and provision the selected profile's models
.\scripts\setup-video-worker.ps1 -Profile detect -DownloadModels
```

Available profiles are `base`, `detect`, `semantic`, `grounding`, `ocr`, `audio`, `depth`, and `full`. The resolver uses `NUWA_WORKER_PYTHON`, the project `.venv`, a Conda environment named `yolo`, the active Conda environment, or Python on `PATH`, in that order.

If PyTorch needs a platform-specific CUDA wheel, install that wheel in the selected Python environment before running setup.

## Configuration

Copy `worker.env.example` to the ignored `worker.env` file and edit only the values you need. Existing shell variables take precedence. Set `HF_HOME` to a persistent cache location before the first authorization or model download. Do not put `HF_TOKEN` in this file: connect Hugging Face from Nuwa's shared Settings page, or provide the token through a deployment secret manager.

Every provider is enabled by default for backward compatibility. A smaller installation should disable providers whose profile is not installed, for example:

```dotenv
NUWA_PROVIDER_LOCATE_ANYTHING=false
NUWA_PROVIDER_QWEN_VL=false
NUWA_PROVIDER_TROCR=false
NUWA_PROVIDER_WHISPER=false
NUWA_PROVIDER_DEPTH_ANYTHING=false
```

Model identifiers and revisions can be set independently. Immutable Hugging Face commit revisions are recommended for reproducible deployments. `QWEN_LOCAL_MODEL_PATH` and `LOCATE_ANYTHING_MODEL` can point to already downloaded local model directories. The Settings page reports the resolved model path before any explicit preparation action. OCR is the exception: the compatibility provider id remains `trocr`, but its implementation uses RapidOCR's package-bundled ONNX text detector and Chinese/English recognizer, so it does not require a Hugging Face model download.

Hugging Face authorization and model preparation are separate operations. Saving a token validates and persists it in the configured Hugging Face cache but does not start a download. If no usable local model is found, the Settings page shows the cache location and asks for confirmation before downloading.

## Diagnose and provision

```powershell
.\scripts\check-video-environment.ps1

cd workers\video-annotation
python -m nuwa_worker doctor
python -m nuwa_worker models list
python -m nuwa_worker models verify --profile detect
python -m nuwa_worker models download --profile detect
python -m nuwa_worker models download --provider qwen_vl
```

The diagnostic output reports dependencies, cache readiness, device selection, FFmpeg, disk space, and whether gated models need Hugging Face authentication. It never prints token contents. Downloaded model paths and resolved revisions are recorded in the runtime data directory's `models-manifest.json`.

## Start

```powershell
.\scripts\start-video-worker.ps1
.\scripts\start-all.ps1
```

## API

- `GET /health` returns worker, device, queue, and currently loaded model state.
- `GET /models` returns real provider dependency/cache/readiness details.
- `POST /jobs` submits a scene-detection or annotation job.
- `GET /jobs/{id}` returns status, percentage, current phase, result, and error.
- `POST /jobs/{id}/cancel` cancels a job.

Models are still loaded and unloaded sequentially per segment to preserve the current memory behavior and annotation result schema.

OCR runs with ONNX Runtime on the CPU so it does not compete with Qwen, YOLO, or Whisper for GPU memory. New results include structured OCR/speech execution status; videos without an audio stream skip Whisper before the model is loaded.

Qwen semantic output is treated as enrichment rather than object-existence evidence. Objects must be localized by YOLO or the grounding provider before entering the confirmed object list; semantic-only object claims and dependent events are discarded. Detector class names are never replaced by broader or unrelated Qwen guesses.
