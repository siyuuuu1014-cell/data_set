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
- **Optional local providers** — YOLO11, LocateAnything, Qwen3-VL, TrOCR, Whisper, and Depth Anything
- **IoU-based tracking** across processed frames
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

> **Worker configuration:** the scripts share one Python resolver and optionally load `workers/video-annotation/worker.env`. Copy `worker.env.example`, choose an installation profile, and set `HF_HOME` to the persistent cache location you want every Worker to reuse. Hugging Face can be connected once from the shared Settings page, or managed with `HF_TOKEN` in a deployment secret manager.

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
| `QWEN_LOCAL_MODEL` | Local Qwen model identifier |
| `QWEN_LOCAL_MODEL_PATH` | Local Qwen model directory; takes precedence over `QWEN_LOCAL_MODEL` |
| `DEPTH_MODEL` | Depth Anything model identifier or local path |
| `NUWA_PROVIDER_*` | Enable or disable an individual video model provider |
| `NUWA_WORKER_PYTHON` | Explicit Python interpreter used by all worker scripts |
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
| `npm run setup` | Create the project's runtime directories |
| `./scripts/check-video-environment.ps1` | Check local video-worker prerequisites |
| `./scripts/setup-video-worker.ps1 -Profile full` | Install a selectable worker dependency profile (`base`, provider-specific, or `full`) |
| `./scripts/start-video-worker.ps1` | Start the video worker |
| `./scripts/start-all.ps1` | Start the worker and Next.js development server |

There is currently no automated test command or checked-in unit/integration test suite.

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
- Python dependencies use bounded compatible ranges rather than a fully reproducible lock file. Install a platform-specific PyTorch/CUDA build first when required.
- Gated Hugging Face models require one-time authorization from the shared Settings page or an externally managed `HF_TOKEN`. Model preparation is an explicit action and reports the cache/local model path before downloading.
- Video uploads are buffered by the server and may use substantial memory for large files.
- The tracker named `ByteTrackTracker` still implements conservative IoU matching rather than the full ByteTrack algorithm; the video identity registry fixes ID scope and unsafe duplicate assignment but does not replace a production ReID model.
- Focused Worker regression tests cover tracking identity and frame-extraction failures, but there is not yet a complete browser/API end-to-end or data-migration test suite.
- There is no conventional database, multi-user collaboration, per-user authorization, or general migration system.

## License

MIT
