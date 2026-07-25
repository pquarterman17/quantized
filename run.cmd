@echo off
REM ============================================================================
REM  quantized - one-click launcher (Windows). Double-click this file.
REM  First run installs deps + builds the UI; then it starts the app and opens
REM  a browser tab at http://127.0.0.1:8000. Needs `uv` and Node.js installed.
REM ============================================================================
setlocal
cd /d "%~dp0"

REM UV_LINK_MODE=copy used to be forced here to dodge a OneDrive
REM "incompatible hardlinks" sync error. The repo moved off OneDrive
REM (2026-07-25), so uv can hardlink again — which is faster and uses less
REM disk. Re-add it only if this tree ends up on a syncing folder again.

REM First run: create the Python environment.
if not exist ".venv" (
  echo [quantized] First run: installing Python dependencies...
  uv sync
  if errorlevel 1 goto :err
)

REM First run: build the SPA (the build output is gitignored).
if not exist "src\quantized\web\index.html" (
  echo [quantized] First run: building the UI ^(one-time, ~1 min^)...
  pushd frontend
  call npm install
  if errorlevel 1 (popd & goto :err)
  call npm run build
  if errorlevel 1 (popd & goto :err)
  popd
)

echo [quantized] Starting... a browser tab will open at http://127.0.0.1:8000
echo [quantized] Leave this window open while you use the app; press Ctrl+C to stop.
uv run --no-sync qz
goto :eof

:err
echo.
echo [quantized] Setup failed. Make sure Node.js (nodejs.org) and uv (astral.sh/uv) are installed.
pause
exit /b 1
