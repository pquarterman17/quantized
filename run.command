#!/usr/bin/env bash
# =============================================================================
#  quantized - one-click launcher (macOS/Linux). Double-click this file
#  (macOS may require: right-click -> Open the first time, or `chmod +x`).
#  First run installs deps + builds the UI; then starts the app and opens a
#  browser tab at http://127.0.0.1:8000. Needs `uv` and Node.js installed.
# =============================================================================
set -e
cd "$(dirname "$0")"

# Copy link mode avoids a OneDrive "incompatible hardlinks" error on sync.
export UV_LINK_MODE=copy

# First run: create the Python environment.
if [ ! -d ".venv" ]; then
  echo "[quantized] First run: installing Python dependencies..."
  uv sync --link-mode=copy
fi

# First run: build the SPA (the build output is gitignored).
if [ ! -f "src/quantized/web/index.html" ]; then
  echo "[quantized] First run: building the UI (one-time, ~1 min)..."
  ( cd frontend && npm install && npm run build ) || {
    echo "[quantized] Setup failed. Install Node.js (nodejs.org) and uv (astral.sh/uv)."
    exit 1
  }
fi

echo "[quantized] Starting... a browser tab will open at http://127.0.0.1:8000"
echo "[quantized] Leave this window open while you use the app; press Ctrl+C to stop."
exec uv run --no-sync qz
