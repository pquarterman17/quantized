# Performance envelope (P0.4)

Measured limits of the current architecture at large-data and long-session
scale, per `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P0.4: evidence FIRST, then
rendering/storage architecture decisions. Raw dated records (hardware,
fixture, command, measurement) live beside this file in `docs/envelope/`.

Rerun:

```bash
# backend half (generates large fixtures on demand, ~mins for the 1M CSV)
uv run python tools/baselines/envelope.py

# frontend half (real backend + built SPA + Chromium via Playwright)
cd tools/bench && npm install && node frontend_envelope.mjs
```

## First run — 2026-07-26

**Hardware:** Windows 11 (10.0.26200), AMD Ryzen 7 7800X3D, 16 logical
cores, 64 GB RAM. Backend: Python 3.14.5. Frontend: Node 24.15.0,
Playwright 1.62.0, Chromium 151. One machine, one dated sample — treat
absolutes as indicative (F1 upload+parse varied ~14 s vs ~28 s across two
runs; the qualitative conclusions held in both).

### Backend (pure io/calc; best-of-3 unless noted; peak mem via tracemalloc)

| Case | Fixture | Wall | Peak mem | Notes |
|---|---|---|---|---|
| CSV import 1M×8 (`import_auto`) | 70.0 MB | 5.96 s | 1,117 MB | **16× expansion** vs file bytes |
| Correction chain 1M×4 | synthetic | 205 ms | 109 MB | trims to 900k rows as designed |
| Map import 500² / 1000² / 2000² | 1.1 / 3.8 / 14 MB | 50 / 192 / 743 ms | 30 / 116 / 453 MB | scales ~linearly |
| Map render (contourf SVG) 500² / 1000² / 2000² | — | 127 / 218 / 601 ms | 8.8 / 31 / 119 MB | SVG 0.6 / 2.2 / 8.3 MB |
| Line-cut 500² / 1000² / 2000² | — | 0.1 / 0.7 / 10 ms | ~0 | non-issue |
| Dense multi-series render 20×100k, full res | 19.6 MB | 2.83 s | 103 MB | 4.4 MB SVG |
| Same after `resample_data` to ~2k/series | — | 186 ms | 4.3 MB | 15× faster, 5.7× smaller |
| Figure export 1M-pt series SVG / PNG | synthetic | 98 / 150 ms | 54 MB | matplotlib path-simplify makes this a non-issue |
| Plot payload build (`/api/plot/series` pure path), 1M×7 | 70.0 MB | 179 ms pack + 1.72 s encode | 264 MB | **78.0 MB JSON payload** |

### Frontend (real app end-to-end; latency = input→next paint)

| Case | Measurement | Value | Notes |
|---|---|---|---|
| F1: 1M×8 CSV | upload+parse | 27.9 s (13.9 s on a warm rerun) | click→dataset appears |
| F1 | first rendered frame | 874 ms | after dataset appears |
| F1 | plotted | 1,000,000 rows × 7 series | **no cap, no downsampling** |
| F1 | JS heap after | 558 MB | 5 MB before |
| F1 | pan median/p95 | 50 / 52 ms | meets <100 ms |
| F1 | zoom median/p95 | 106 / **259 ms** | **misses <100 ms** |
| F2: 50 datasets + 20 windows | total setup | 10.0 s | imports 8.1 s of that |
| F2 | window open 1st/20th | 107 / 95 ms | no O(n) drift |
| F2 | pan, zoom p95 (busiest window) | 51, 68 ms | meets <100 ms |
| F2 | JS heap | 5 → 21 MB | small fixtures |
| F3: dense 20×100k | upload+parse / first frame | 2.8 s / 410 ms | all 20 series, no cap |
| F3 | pan p95 / zoom p95 | 60 / **122 ms** | zoom misses at density |
| F4: `.dwk` @ F2 session | serialize / size | 13 ms / 3.6 MB | cheap at this scale |
| F4 | autosave latency | 817 ms | ≈800 ms debounce + ~17 ms write |
| F4 | reopen (restore / first paint) | 194 / ~1 ms | |

## Findings (the architecture evidence)

1. **The interactive plot path has zero point reduction, front or back.**
   A correct min/max-bucket downsampler EXISTS (`frontend/src/lib/
   downsample.ts`) but is wired only into Library sparklines; the uPlot
   render path (`usePlotPayload` → `plotdata.buildColumns`) plots every raw
   point, and no decimation sits in front of `/api/plot/series` either
   (backend has `resample_data` — interpolation, wrong tool for spikes — and
   `origin_project/preview.decimate_datastruct` — right idea, single-channel
   extrema, lives outside `calc/`). Consequences measured: 78 MB payload and
   zoom p95 259 ms at 1M rows. This is the #1 evidence-backed fix.
2. **CSV import is the bottleneck class, not a corner case.** ~6 s clean and
   16× memory (1.1 GB for 70 MB) from per-token `float()` in pure-Python
   loops (`io/delimited.py`); worse, the ambiguous-`.csv` sniffer chain
   (`is_sims_file`, `is_lakeshore_file`) each `read_text()` the WHOLE file
   to inspect the first ~4 KB — ~140 MB of throwaway reads before import
   begins. tracemalloc active during import inflates 6 s → 22 s purely from
   small-object churn, confirming allocation volume is the cost.
3. **Pan meets the <100 ms target everywhere measured, including 7M points.
   Zoom does not at scale** (F1 p95 259 ms, F3 p95 122 ms; fine at F2's
   moderate scale). Consistent across two independent runs.
4. **Workspace persistence is NOT currently the problem** at a 50-dataset /
   20-window session: 13 ms serialize, 3.6 MB `.dwk`, 194 ms restore,
   ~17 ms autosave write behind an ~800 ms debounce. Evidence AGAINST
   compressed/chunked containers at this scale (P1.2 keeps its "only if
   P0.4 requires it" answer: not at this scale — but see residuals).
5. **2-D maps are healthy to 2000² on the backend** (sub-second import and
   render, linear scaling); matplotlib 1M-point exports are a non-issue.
6. **Many-window sessions scale cleanly** — no per-window drift over 20
   windows, heap modest.

## Residuals (explicitly unmeasured — carry in P0.4)

- Worksheet-GRID interaction at 1M rows (only import→plot was measured;
  the grid was previously verified to 100k×200 mount only).
- `.dwk` save/reopen containing a 1M-row dataset (F4's session held 50
  SMALL datasets; inline-JSON arrays at 78 MB-payload scale are untested).
- Browser-side 2-D map rendering/interaction at 1000²–2000².
- Network/offline source transitions — unmeasurable today: no offline-vs-
  deleted distinction exists until P1.1 ships. Re-measure after P1.1.
- Copy/export timing at the 1M scale from the UI.
