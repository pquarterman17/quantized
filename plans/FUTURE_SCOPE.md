# Future scope (parked — not on the active to-do list)

Ideas the owner wants kept on record but deliberately NOT scheduled. Nothing
here is a commitment or a checklist; promote an item into an active plan only
when real use shows the need. Record measurements when an item is revisited.

## Compute performance for intensive plots (parked 2026-09-29)

State today (for context when this is revisited):

- **No GPU acceleration.** Interactive plots are uPlot on a 2-D canvas;
  publication export is matplotlib (CPU, server-side).
- **Frontend is effectively single-threaded.** One Web Worker exists (workspace
  file parsing, `frontend/src/lib/parseWorkspaceFile.ts`); plot preparation and
  rendering run on the main thread.
- **Backend parallelism is limited.** NumPy/SciPy use multithreaded BLAS where
  the math goes through them; long jobs (bumps / DREAM) run on a 2-worker
  thread pool (`src/quantized/jobs.py`), mostly single-core per job under the
  GIL; numba (when installed) JIT-compiles the DREAM step.
- **Large plots stay responsive by doing less, not by parallelism:**
  screen-resolution downsampling (`/api/plot/series`, `lib/plotdata.ts`),
  min/max buckets for thumbnails (`lib/downsample.ts`), dataset-handle caching.

Candidate directions, cheapest first:

1. **Web Worker for plot preparation** (downsampling, column packing,
   stat/facet computation) so large datasets never block the UI thread.
2. **Process-level parallelism for heavy fits** — run DREAM chains / model
   scans / peak batches across processes instead of the 2-thread pool.
3. **WebGL renderer for very dense scatter / map views** (millions of points).
   The only real GPU option; a large change against the uPlot-based
   interactive design and the screen≡export parity contract, so it needs its
   own design review before any work.
