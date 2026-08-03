#!/usr/bin/env bash
# nuwa — start all (frontend + worker) for Linux / macOS
# Usage:
#   ./scripts/start.sh                # production mode (build + start)
#   ./scripts/start.sh --dev          # dev mode (worker reload + next dev)
#   ./scripts/start.sh --port 8765    # custom worker port

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$ROOT/workers/video-annotation"
WORKER_PORT="${NUWA_WORKER_PORT:-${WORKER_PORT:-8765}}"
FRONTEND_PORT=3000
DEV_MODE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dev) DEV_MODE=1 ;;
    --port)
      # The loop's trailing shift consumes the value argument.
      shift
      if [ "$#" -lt 1 ] || [ -z "$1" ]; then
        echo "  ERROR: --port requires a value" >&2
        exit 1
      fi
      WORKER_PORT="$1"
      ;;
    *) echo "Unknown argument: $1 (supported: --dev, --port N)" >&2 ;;
  esac
  shift
done

echo "=== nuwa — Starting All Services ==="

# ── Locate Python (prefer venv, then python3) ────────────
PYTHON_BIN="${NUWA_PYTHON:-}"
if [ -z "$PYTHON_BIN" ] && [ -x "$WORKER_DIR/.venv/bin/python" ]; then
  PYTHON_BIN="$WORKER_DIR/.venv/bin/python"
fi
if [ -z "$PYTHON_BIN" ]; then
  PYTHON_BIN="$(command -v python3 || command -v python || true)"
fi
if [ -z "$PYTHON_BIN" ]; then
  echo "  ERROR: Python 3 not found. Install Python 3.12+ or set NUWA_PYTHON." >&2
  exit 1
fi
echo "  Python: $PYTHON_BIN"

# ── Load worker.env if present ───────────────────────────
ENV_FILE="$WORKER_DIR/worker.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

export PYTHONPATH="$WORKER_DIR"
export WORKER_PORT="$WORKER_PORT"
export WORKER_HOST="${WORKER_HOST:-127.0.0.1}"
if [ -z "${VIDEO_ANNOTATION_DATA_ROOT:-}" ]; then
  export VIDEO_ANNOTATION_DATA_ROOT="$ROOT/data/video-annotations"
fi

# ── Port-in-use check ────────────────────────────────────
if (command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$WORKER_PORT" | grep -q ":$WORKER_PORT") \
   || (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$WORKER_PORT" -sTCP:LISTEN >/dev/null 2>&1); then
  echo "  ERROR: Port $WORKER_PORT is already in use. Stop the existing Video Worker first." >&2
  exit 1
fi

# ── Start worker in background ───────────────────────────
echo "  Worker starting on port $WORKER_PORT..."
if [ "$DEV_MODE" -eq 1 ]; then
  (cd "$WORKER_DIR" && "$PYTHON_BIN" -m uvicorn app:app --host "$WORKER_HOST" --port "$WORKER_PORT" --log-level info --reload) &
else
  (cd "$WORKER_DIR" && "$PYTHON_BIN" -c "
import sys; sys.path.insert(0, '.')
from app import app
import uvicorn
uvicorn.run(app, host='$WORKER_HOST', port=$WORKER_PORT, log_level='info')
") &
fi
WORKER_PID=$!
trap 'echo; echo "  Stopping worker (pid $WORKER_PID)..."; kill "$WORKER_PID" 2>/dev/null || true' EXIT INT TERM

# ── Wait for worker health endpoint ──────────────────────
HEALTH_URL="http://${WORKER_HOST}:${WORKER_PORT}/health"
HEALTHY=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null | grep -q '"status": *"ok"'; then
    HEALTHY=1
    break
  fi
  sleep 1
done
if [ "$HEALTHY" -eq 1 ]; then
  echo "  Worker healthy on port $WORKER_PORT."
else
  echo "  WARNING: Worker did not become healthy within 30s." >&2
  echo "  The frontend may return transient 503 errors while the Worker finishes starting." >&2
fi

# ── Start frontend ───────────────────────────────────────
echo "  Frontend starting on port $FRONTEND_PORT..."
cd "$ROOT"
if [ "$DEV_MODE" -eq 1 ]; then
  npm run dev
else
  npm run build && npm run start
fi
