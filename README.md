# Nuwa (女娲) — Intelligent Synthetic Data Platform

[中文版](README.zh-CN.md)

Nuwa is a local-first workspace for creating structured synthetic datasets and reviewing AI-assisted video annotations. It combines a visual schema editor, configurable LLM generation, relational data export, and an optional Python inference worker.

The project is intended primarily for trusted local or internal use. Synthetic project metadata stays in the browser; generated files, video jobs, and model configuration are stored on the local filesystem.

## Features

### Synthetic Data

- **9 column types** — text, number, boolean, date, ID, phone, city, foreign key, and foreign key array
- **8 ID formats** — UUID v4/v7, Snowflake, auto-increment, CUID2, MongoDB ObjectId, Nano ID, and ULID
- **6 export formats** — JSON, CSV, XLSX, XML, SQL INSERT, and Parquet
- **LLM-assisted generation** — use OpenAI- or Anthropic-compatible APIs for text values and number/date generator code
- **Relational schemas** — reference another table with scalar or array foreign-key columns
- **Visual editing and statistics** — reorder columns, preview rows, and inspect generated distributions
- **Persistent generated data** — save table rows as server-side Parquet files
- **English and Chinese UI** — switch the synthetic-data workspace language in the browser

### Video Annotation

- **Batch video upload** with persistent, file-backed annotation jobs
- **Scene-aware processing** before model inference
- **Optional local providers** — YOLO11, LocateAnything, Qwen3-VL, RapidOCR, Whisper, and Depth Anything
- **ByteTrack tracking** with Kalman prediction, two-stage confidence association, and a configurable legacy IoU fallback
- **Human review** with a canvas editor, scene navigation, and timeline
- **Custom JSON, COCO, and YOLO ZIP export** with labels and keyframe images

## Architecture

```text
Browser
├── Next.js pages and React components
├── Synthetic project state in localStorage
└── Video review and canvas annotation state
        │
        ▼
Next.js server
├── LLM configuration and OpenAI/Anthropic proxy
├── Parquet persistence, restoration, and download
├── Video upload and streaming
└── File-backed video task APIs
        │
        ├──────────────► OpenAI- or Anthropic-compatible LLM provider
        │
        ▼
Python video worker (optional; default 127.0.0.1:8765)
├── FFmpeg/FFprobe scene and frame processing
├── Detection, grounding, OCR, speech, depth, and VLM providers
└── Local model files / Hugging Face downloads
```

### Browser Layer

Pages under `app/` render the application. The project and table pages edit schemas, generate rows, display statistics, and export datasets through modules in `services/`. `services/store.tsx` persists project metadata in browser `localStorage`.

The video review experience lives mainly in `components/video-annotation/`. It loads file-backed tasks through the Next.js APIs and keeps the active editing state in React.

### Next.js Server Layer

Route handlers under `app/api/` save LLM configuration, proxy generation requests, read and write Parquet data, accept and stream videos, manage annotation sets, and forward segment jobs to the Python worker.

### Python Worker Layer

`workers/video-annotation/` is a separate FastAPI service for media processing and local inference. The synthetic-data workspace works without it. Automatic video processing requires the worker, FFmpeg, and the dependencies for each enabled model provider.

## Storage Model

Nuwa does not currently use a conventional database.

| Data | Location | Main implementation |
|---|---|---|
| Project, table, and annotation-set metadata | Browser `localStorage` key `nuwa-store` | `services/store.tsx` |
| UI language | Browser `localStorage` key `nuwa-lang` | `services/i18n.tsx` |
| LLM settings | `configs/llm-config.json` | `app/api/llm/config/route.ts` |
| Generated-code cache | `configs/code-cache.json` | LLM/code-generation services |
| Parquet output | `generated_data/{projectId}/{tableName}.parquet` | `app/api/data/`, `services/parquet.ts` |
| Video task metadata | `data/video-annotations/tasks/{id}/task.json` | Annotation-set APIs |
| Videos and worker artifacts | `data/video-annotations/` | Video APIs and `workers/video-annotation/` |

File-backed storage is best suited to one local server process. Multi-instance deployments require external persistence and concurrency control.

## Core Workflows

### Synthetic Data Flow

```text
Create/open project
  → define tables and columns
  → create blank preview rows
  → generate each configured column
  → optionally call /api/llm
  → inspect data and statistics
  → export the selected format
```

Generation is orchestrated in the browser by `services/data-gen.ts` and `services/code-gen.ts`. Text columns call the configured LLM directly through `/api/llm`; number and date prompts may ask the LLM to produce generator expressions. Saved rows are written to Parquet through `/api/data`; JSON, CSV, XLSX, XML, and SQL exports are created in the browser.

### Video Annotation Flow

```text
Upload videos
  → create and persist a task
  → request processing through the Next.js API
  → send the job to the Python worker
  → probe the video and split scenes
  → run installed model providers
  → save frames and model output
  → review/edit annotations in the browser
  → export JSON, COCO, or YOLO ZIP
```

Each model provider is optional. A job can only use providers whose dependencies and model weights are available in the worker environment.

## Tech Stack

| Area | Technology |
|---|---|
| Web | Next.js 16, React 19, TypeScript |
| Styling and UI | Tailwind CSS 4 and project-local React components |
| Data export | parquetjs, JSZip, and browser-side exporters |
| Video worker | Python, FastAPI, Uvicorn |
| Media | FFmpeg, FFprobe, Pillow |
| Optional AI | PyTorch, Ultralytics YOLO, and Transformers-based providers |
| Persistence | Browser `localStorage` and local JSON/binary files |

## Quick Start

### Web Application

Requirements:

- Node.js 20 or newer is recommended
- npm

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Configure LLM (Optional)

Open **Settings** and configure an OpenAI- or Anthropic-compatible provider, model, endpoint, and API key. Deterministic generators do not require an external model.

### Create a Dataset

Create a project and add one or more tables.

### Define Tables and Columns

Configure each column's type and generator. Foreign-key columns reference another table.

### Generate and Export

Create preview rows, generate each required column, and review the resulting data and statistics.

For production:

```bash
npm run build
npm run start
```

## Video Worker Setup

Additional requirements:

- Python 3.12 or newer
- FFmpeg and FFprobe on `PATH`, or configured explicitly
- Sufficient disk space for uploads, frames, model weights, and caches
- A CUDA-capable GPU is recommended for heavier local providers

The checked-in helper scripts target PowerShell on Windows:

```powershell
./scripts/check-video-environment.ps1
./scripts/setup-video-worker.ps1
./scripts/start-video-worker.ps1
# Or start the worker and Next.js development server together:
./scripts/start-all.ps1
```

Run the web application separately with `npm run dev`.

`setup-video-worker.ps1` creates `workers/video-annotation/.venv`; the start and environment-check scripts use that Nuwa-only interpreter and never fall back to an active Conda/base environment. This keeps Nuwa's model dependencies from changing other projects. `NUWA_WORKER_PYTHON` remains available only for an explicitly selected, Nuwa-dedicated interpreter.

On the currently validated Windows/NVIDIA setup, install the full profile with the matching CUDA wheel index:

```powershell
./scripts/setup-video-worker.ps1 -Profile full `
  -TorchIndexUrl https://download.pytorch.org/whl/cu132 `
  -TorchVersion 2.13.0+cu132 `
  -TorchvisionVersion 0.28.0+cu132
```

Omit the three PyTorch options for a CPU installation, or select the index and versions that match the deployment GPU driver. The LocateAnything-compatible Transformers version is pinned to `4.57.1`.

> **Worker configuration:** the scripts optionally load `workers/video-annotation/worker.env`. Copy `worker.env.example`, choose an installation profile, and set `HF_HOME` to a persistent cache location so existing model weights are reused. Hugging Face can be connected once from the shared Settings page, or managed with `HF_TOKEN` in a deployment secret manager. Setup does not download model weights unless `-DownloadModels` is passed.

## Column Types

| Type | Purpose |
|---|---|
| `text` | Generate values directly from an LLM prompt |
| `number` | Run custom or LLM-generated side-effect-free expressions, with a random fallback |
| `boolean` | Generate `1` or `0` with a configurable true ratio |
| `date` | Use date distributions, custom expressions, or LLM-generated expressions |
| `id` | Generate unique IDs in one of eight formats |
| `phone` | Generate country-specific phone numbers |
| `city` | Generate city names for a selected country |
| `foreign_key` | Reference a row in another generated table |
| `foreign_key_array` | Reference multiple rows in another table |

## Export Formats

JSON · CSV · Excel (XLSX) · XML · SQL INSERT · Parquet

Video annotations can also be exported as custom JSON, COCO JSON, or a YOLO ZIP containing labels, classes, and available keyframe images.

## API Overview

### Next.js APIs

| Route family | Responsibility |
|---|---|
| `/api/llm/config` | Load and save provider settings |
| `/api/llm` | Proxy OpenAI- or Anthropic-compatible generation requests |
| `/api/data` | Read, write, count, and delete table Parquet data |
| `/api/data/download` | Download a table's Parquet file |
| `/api/data/fk-values` | Load stored rows for foreign-key generation |
| `/api/restore/tables` | Discover server-side Parquet tables for restoration |
| `/api/video-annotation/annotate-sets/*` | Create, restore, poll, update, and delete annotation sets |
| `/api/video-annotation/upload` | Upload source videos |
| `/api/video-annotation/files/*` | Stream videos and extract timestamped frames |
| `/api/video-annotation/segments/*` | Detect scenes and submit segment annotation jobs |
| `/api/video-annotation/worker/health` | Check worker health |

The FastAPI worker exposes health, status, and processing endpoints used by the Next.js server. Its default address is `http://127.0.0.1:8765`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `WORKER_HOST` | Worker bind host; default `127.0.0.1` |
| `WORKER_PORT` | Worker port; default `8765` |
| `VIDEO_ANNOTATION_WORKER_URL` | Worker URL used by the Next.js server; default `http://127.0.0.1:8765` |
| `GPU_CONCURRENCY` | Maximum concurrent GPU-heavy jobs |
| `VIDEO_ANNOTATION_DATA_ROOT` | Worker data root; the Next.js video APIs currently use `data/video-annotations` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Explicit media-tool paths |
| `SCENE_THRESHOLD` | Worker scene-detection threshold |
| `YOLO_MODEL` | YOLO model name or path |
| `LOCATE_ANYTHING_MODEL` | LocateAnything repository identifier or existing local snapshot directory |
| `LOCATE_MAX_SIDE` / `LOCATE_MAX_NEW_TOKENS` | LocateAnything visual-input and response limits; defaults are `1024` and `512` |
| `LOCATE_GENERATION_MODE` | LocateAnything generation mode; `hybrid` preserves the default accuracy path, while optional `fast` may reduce complex-scene quality |
| `LOCATE_CATEGORY_MODE` | Grounding category strategy for precision jobs: `adaptive` (default) or `full` |
| `LOCATE_ADAPTIVE_MAX_CATEGORIES` / `LOCATE_ADAPTIVE_GENERATION_MODE` / `LOCATE_ADAPTIVE_MAX_NEW_TOKENS` | Bounds for adaptive precision jobs; defaults are `18`, `fast`, and `256` |
| `QWEN_LOCAL_MODEL` | Local Qwen model identifier |
| `QWEN_LOCAL_MODEL_PATH` | Local Qwen model directory; takes precedence over `QWEN_LOCAL_MODEL` |
| `DEPTH_MODEL` | Depth Anything model identifier or local path |
| `NUWA_PROVIDER_*` | Enable or disable an individual video model provider |
| `NUWA_TRACKER_BACKEND` | Tracking backend: `bytetrack` by default, or `iou` for the legacy fallback |
| `TRACK_LOW_THRESHOLD` / `TRACK_HIGH_THRESHOLD` / `TRACK_MATCH_THRESHOLD` / `TRACK_BUFFER` | ByteTrack confidence, association, and lost-track settings |
| `NUWA_WORKER_PYTHON` | Explicit Python interpreter used by all worker scripts |
| `NUWA_TORCH_INDEX_URL` / `NUWA_TORCH_VERSION` / `NUWA_TORCHVISION_VERSION` | Optional setup-time GPU wheel source and exact PyTorch versions |
| `HF_TOKEN` | Optional Hugging Face access token |
| `HF_HOME` / `HF_HUB_CACHE` | Hugging Face cache locations |
| `NUWA_AUTH_USER` / `NUWA_AUTH_PASSWORD` | Optional HTTP Basic credentials; set both when serving Nuwa on a shared network |
| `NUWA_LLM_ALLOWED_PRIVATE_HOSTS` | Comma-separated exact host names/IPs allowed for private-network LLM endpoints; loopback remains allowed automatically |

When changing the worker bind host or port, set `VIDEO_ANNOTATION_WORKER_URL` in the Next.js process to the matching reachable URL.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run the TypeScript compiler without emitting files |
| `npm test` | Run Node regression tests, Worker unit tests, and TypeScript checks |
| `npm run test:node` | Run streaming-upload and model-result regression tests |
| `npm run test:worker` | Run Worker unit tests with the project-local Python environment |
| `npm run setup` | Create the project's runtime directories |
| `./scripts/check-video-environment.ps1` | Check local video-worker prerequisites |
| `./scripts/setup-video-worker.ps1 -Profile full` | Install a selectable worker dependency profile (`base`, provider-specific, or `full`) |
| `./scripts/start-video-worker.ps1` | Start the video worker |
| `./scripts/start-all.ps1` | Start the worker and Next.js development server |

`npm test` is the unified non-inference regression entry point. It covers the streaming upload sink, interrupted/oversized upload cleanup, preservation of human annotations across model reruns, provider status rules, ByteTrack two-stage association, tracking identity, OCR, semantic parsing, and result merging. A full browser/API test that executes real models remains separate because it requires media fixtures and configured model providers.

## Project Structure

```text
nuwa/
├── app/
│   ├── api/
│   │   ├── data/                    # Parquet persistence and downloads
│   │   ├── llm/                     # LLM config and generation proxy
│   │   ├── restore/                 # Discover restorable server data
│   │   └── video-annotation/        # Upload, annotation-set, segment, and worker APIs
│   ├── project/[id]/
│   │   ├── table/                   # Table schema, generation, statistics, and export
│   │   └── annotate/                # Annotation-set list and editor
│   ├── restore/                     # Parquet restoration page
│   ├── settings/                    # LLM settings page
│   ├── layout.tsx                   # Root layout
│   └── page.tsx                     # Project-list home page
├── components/
│   ├── video-annotation/            # Upload, canvas, playback, review, and export UI
│   └── LangToggle.tsx               # Language switcher
├── services/
│   ├── data-gen.ts                  # Column-by-column generation orchestration
│   ├── code-gen.ts                  # IDs, dates, phone/city data, and expression execution
│   ├── export.ts                    # JSON, CSV, XLSX, XML, and SQL exporters
│   ├── llm.ts                       # Browser-side LLM API client
│   ├── parquet.ts                   # Server-side Parquet persistence
│   ├── stats.ts                     # Generated-data statistics
│   ├── store.tsx                    # Browser project state
│   └── video-annotation/            # Video types, worker client, canvas, and exporters
├── workers/video-annotation/
│   ├── providers/                   # Detection, tracking, VLM, OCR, audio, and depth
│   ├── pipeline.py                  # Processing pipeline
│   ├── services/                    # Scene detection, video identity, and frame/video helpers
│   ├── tests/                       # Focused Worker regression tests
│   ├── worker.py                    # In-process job queue
│   └── app.py                       # FastAPI entry point
├── scripts/                         # Runtime setup and Windows worker helpers
├── configs/                         # LLM settings and generated-code cache
├── generated_data/                  # Parquet output
├── data/video-annotations/          # Uploads, tasks, caches, exports, and temp data
├── package.json                     # Web scripts and dependencies
└── README.zh-CN.md                  # Chinese documentation
```

## Track and Person Identity

- `trackId` remains numeric and identifies a video-scoped track. The segment-local tracker enforces one-to-one association inside each frame, then a persistent per-video registry remaps local IDs before depth, merge, review, and export.
- Re-annotating the same segment reuses its stored mapping. Temporally adjacent boundary tracks are continued only when class and bounding-box overlap provide a high-confidence one-to-one match; ambiguous tracks receive new IDs to avoid merging different people.
- `personId` is assigned from the video-scoped tracking identity (`<videoId>:person:<trackId>`). Qwen semantic attributes are no longer hashed to create identity because different people can share gender, age, hair, and clothing descriptions.
- Identity registry files live under `data/video-annotations/cache/video-identities/`. Keep this cache with the task data when stable IDs must survive Worker restarts. Existing saved annotations are not rewritten automatically; re-annotate a segment to generate IDs under the new policy.
- This conservative policy does not claim cross-shot biometric ReID. A person returning after a hard cut or long gap can receive a new identity, which is safer than silently combining two different people.

Run the focused Worker regression tests with the same Python interpreter used by the Worker:

```powershell
cd workers/video-annotation
python -m unittest discover -s tests -v
```

## Provider Output Contracts

- Qwen categorical values use exact or complete word/phrase matching. In particular, `female` cannot be classified as `male` through substring matching; the short age outputs `young` and `middle` are handled through explicit aliases.
- The Qwen prompt contains no concrete object/event example that can be copied as a false detection and explicitly requires visual evidence. Qwen may enrich detector-confirmed object attributes, but an unlocalized Qwen-only object is not exported as a confirmed object and cannot rename a detector class.
- YOLO detection uses `None` as the sentinel for configured confidence/IoU defaults. Explicit values such as `iou=0.45`, `iou=0.0`, or `conf=0.0` are preserved.
- RapidOCR performs full-frame text detection plus Chinese/English recognition on the CPU. OCR checks the start, middle, and end keyframes of each segment, deduplicates repeated lines, and retains the highest-confidence pixel bounding box; the historical `trocr` provider id remains accepted for configuration compatibility.
- Whisper returns `{"text": "..."}` when speech is recognized. It does not fabricate a confidence score or return timestamped `segments`; failures are reported separately from a valid no-speech result.
- New segment results include an internal `_recognition` status for OCR and speech (`completed`, `no_content`, `no_audio`, `disabled`, `skipped`, or `failed`). The review page displays these states even when no text was produced.
- LocateAnything declares its required Transformers, PEFT, Decord, and LMDB versions. Provider readiness reports `incompatible_dependency` or `missing_dependency` instead of `ready`, and model preparation is blocked before any unnecessary model download. The Worker reuses the configured Hugging Face cache; these Python runtime libraries do not duplicate model weights.
- LocateAnything uses the supported PyTorch SDPA attention path. Missing optional FlashAttention or MagiAttention produces a performance warning and a functional SDPA fallback, not a failed annotation.
- When the configured local LocateAnything snapshot includes NVIDIA's optimized hybrid executor, the Worker uses it automatically and falls back to the original `generate()` path if it is unavailable. The default 1024-pixel input bound matches that runtime, category prompts use the model's official `</c>` separator, and logs now report model-load and grounding times separately. Detection categories, merge rules, and exported JSON fields are unchanged.
- Ordinary **Annotate**, **Re-run Segment**, **Re-run All**, and failed-segment retries explicitly skip LocateAnything for each Worker job; all other providers, OCR, speech, tracking, review, and export behavior remain unchanged. In the segment review toolbar, **Precise Locate** enables LocateAnything for that selected segment only. It is accepted only when enhanced mode is active and its model is ready, so an unavailable provider cannot be silently reported as a precision run.
- Segment task state records whether the current or last completed run was standard or precise. This execution metadata is used by the page only and does not change the annotation or export JSON schema. A re-run still updates only `modelAnnotation` and preserves the human-reviewed copy.
- New pipeline results include `_provider_statuses`. If an enabled core visual provider (YOLO, tracker, LocateAnything, or Qwen) fails or cannot produce its required input, the usable result is retained but the segment, video, and annotation set are reported as `partial_completed`; Qwen inference and invalid-response errors are no longer converted into empty successful results. Explicitly disabled providers do not degrade a job, and a tracker skipped because detection found no objects is treated as a valid empty result. The review page exposes degraded states and permits targeted re-annotation. Historical completed results containing a known core-provider error are normalized to the same state when read.
- Speech recognition is stored in the top-level `speechTranscript` field and is not treated as a visual event. The UI and Custom JSON exporter migrate historical `[Speech] ...` entries at read/export time, while OCR remains represented by localized text objects.
- Visual events contain a fixed `type` and a short `description` of what is visibly happening. Qwen is asked for these fields before long person/object arrays so truncated output is less likely to omit them. If the semantic event is absent or rejected for an unsupported object claim, Nuwa derives one `visual_activity` summary only from localized people, their recognized actions, and localized non-text objects.
- **Edit JSON** preserves OCR text objects, displays `speechTranscript` separately, and keeps historical free-form visual events selectable. Runtime-only `_recognition`, `_pipeline_errors`, `_provider_statuses`, and `_pipeline_status` remain in internal task storage for diagnostics but are hidden from editable and exported annotation JSON. Existing saved annotations with an empty event list receive the same grounded visual fallback in review and Custom JSON export; re-run a segment only when fresh model recognition is required.
- Human review selectors for scene, camera, person, clothing, object, and event labels include a **Custom…** option. Selecting it opens a text input and stores the supplied string without changing the existing annotation schema. Boolean fields remain constrained, while occlusion accepts any numeric value from 0 to 1.
- OCR lines and the speech transcript are directly editable in the Segment Text & Speech panel. Saving creates a human annotation, updates both the OCR text and its object name, migrates legacy speech events to `speechTranscript`, and preserves the correction even when a false OCR/speech result is cleared. Clearing an OCR line removes that false text object; clearing the transcript removes the human-visible transcript.
- Re-running a segment updates `modelAnnotation` without deleting its `humanAnnotation`. The reviewed copy remains authoritative in the UI, while the new model output and diagnostics remain available separately.

## Video Annotation Exports

- The `video.description` field in Custom JSON is a single video-level sentence generated from the chronological semantics of every available annotation segment: scene, grounded people/objects, visual events, OCR, and speech context. Nuwa uses the shared OpenAI- or Anthropic-compatible LLM configured in **Settings**; long videos are summarized in chronological chunks and reduced to one final sentence.
- Video-description generation does not re-run the video Worker or download another vision model. If the shared LLM is unconfigured or unavailable, export still completes with the previous deterministic local summary and the page reports that fallback.
- Segment exports keep `speechTranscript` separate from visual-only `events`; each visual event may include its concise frame/segment `description`.
- **Export Current Segment JSON** downloads only the currently selected segment while its outer `video.description` still summarizes the whole video. **Export All Annotations** keeps the existing JSON, YOLO ZIP, and COCO export flow.
- Nuwa's persistent annotation unit is a scene segment (`S1`, `S2`, ...), which may combine observations from multiple sampled frames. The single-item export therefore exports one selected segment annotation, not an annotation for every encoded video frame.

## Failed Segment Recovery

- Failed segments can be selected individually with checkboxes. Use **Select All Failed** as a shortcut, then **Retry Selected** to submit only that subset; the existing per-segment retry and full re-run actions remain available.
- Annotation task-file updates are serialized so status polling cannot overwrite a newly submitted Worker Job ID with an older snapshot. A genuinely missing Worker job is reported as a stale Job ID with a retry instruction instead of a bare `HTTP 404`.
- Standard retries do not invoke LocateAnything. Open a selected segment and use **Precise Locate** only when additional grounding is worth the longer GPU run; if enhanced mode is not ready, the API returns a clear error and does not enqueue a misleading standard job.

## Security and Deployment Notes

- Nuwa remains password-free for trusted local use. When serving it on a shared network, set both `NUWA_AUTH_USER` and `NUWA_AUTH_PASSWORD` to enable HTTP Basic authentication. Nuwa does not provide per-user authorization.
- State-changing API requests reject cross-site browser origins.
- LLM API keys are stored in a local JSON file. Protect the host filesystem and do not commit runtime configuration.
- The worker scripts do not contain an access token. The shared Settings page can validate and persist a token in the configured Hugging Face cache; authorization alone never starts a model download. Remote deployments should instead prefer a secret manager and HTTPS.
- Custom and LLM-generated values run through a restricted, side-effect-free expression interpreter. It supports the documented row/reference/random/Math/Date helpers but does not permit statements, assignments, global access, or dynamic code execution.
- LLM requests allow public HTTP(S) providers and loopback services such as Ollama. Private-network endpoints must be explicitly listed in `NUWA_LLM_ALLOWED_PRIVATE_HOSTS`.
- API path parameters are validated and resolved inside their designated data roots; invalid traversal-style names are rejected.
- Videos, frames, model weights, caches, and datasets can consume significant disk space.
- Persistent volumes are required when deploying the file-backed server components.

## Current Limitations

- The video annotation module remains under active development; provider behavior also depends on upstream model implementations, FFmpeg, and available CPU/GPU memory.
- **LocateAnything compatibility repair (validated 2026-07-26):** Nuwa pins Transformers `4.57.1`, PEFT `0.19.1`, Decord `0.6.0`, and LMDB `1.7.5`, uses an isolated Worker environment, selects SDPA instead of the unsupported eager attention path, checks dependencies before reporting readiness, and exposes degraded completion. A real 0–8 second `S1` run completed with YOLO, tracking, LocateAnything, Qwen, OCR, speech, and depth; `_provider_statuses.locate_anything` and `_pipeline_status` were both `completed`.
- On the validated 8GB Windows GPU, LocateAnything's SDPA/hybrid path can still take minutes and approach the VRAM limit. It is therefore opt-in per segment rather than part of ordinary annotation. Adaptive category selection and a bounded fast-first path reduce expected precision-job work, but no new real-model speed claim is made for that path; `LOCATE_CATEGORY_MODE=full` remains available when completeness is more important than latency.
- The inspected historical `ign` task was produced while LocateAnything was failing in all 62 segments. Reading the task now exposes those results as `partial_completed`, but saved model annotations are not regenerated automatically; re-annotate the selected affected segments after restarting the Worker.
- Detection quality is still limited by `yolo11n`, fixed `0.5 FPS` sampling, and a `0.65` confidence threshold. Qwen is deliberately conservative, and unlocalized Qwen-only objects are discarded. Small, brief, occluded, or non-COCO targets can therefore still be missed even after LocateAnything compatibility is restored.
- Very short scene segments can produce no detection frame at the current fixed sample rate. Adaptive sampling, a mandatory midpoint-frame fallback, short-segment handling, balanced Qwen evidence, and YOLO model/threshold benchmarking remain planned work; see `PROJECT_STATUS_AND_ISSUES.md` P1-6.
- Transformers, LocateAnything's direct remote-code dependencies, and the validated Windows CUDA PyTorch build are exact-versioned; several other Python dependencies still use bounded compatible ranges rather than a complete transitive lock file.
- Gated Hugging Face models require one-time authorization from the shared Settings page or an externally managed `HF_TOKEN`. Model preparation is an explicit action and reports the cache/local model path before downloading.
- Video uploads are parsed directly from the multipart request stream, written through a bounded temporary file, and hashed incrementally; interrupted, invalid, and oversized requests clean up their temporary upload directory. The automated suite verifies bounded-stream behavior with small fixtures, while a deployment-scale 2GB memory stress test is still recommended.
- The default tracker now uses Ultralytics ByteTrack with Kalman prediction and high/low-confidence association. Low-confidence detections may maintain a confirmed track but cannot create a new exported track. `NUWA_TRACKER_BACKEND=iou` restores the deterministic legacy implementation. This remains within-segment motion tracking and does not replace production cross-shot ReID.
- `npm test` provides a unified Node/Worker/typecheck regression entry point, but there is not yet a complete real-model browser end-to-end or general data-migration test suite.
- There is no conventional database, multi-user collaboration, per-user authorization, or general migration system.

## License

MIT
