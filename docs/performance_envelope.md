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

## Follow-up run — 2026-07-26, after the first two fixes

The two booked follow-ups shipped same-day (`51af22d` backend, `244551c`
frontend) and were re-measured with the same harnesses:

| Metric | Before | After | Note |
|---|---|---|---|
| Sniff cost, `resolve_parser` on the 70 MB CSV | 63.2 ms | 0.51 ms | bounded `read_head` class fix, 5 sniffers converted |
| 1M×8 import peak memory | 1,117 MB | 869 MB | tokenize/convert vectorized (isolated step: 416→136 MB, 4.1→3.1 s) |
| 1M×8 import wall | ~6–7 s | ~7 s | flat — see finding 7 |
| Points fed to uPlot at 1M×7 | 7,000,000 | ~82,000 | window-aware min/max decimation, default on, disengaged ≤10k rows |
| F1 zoom p95 | 259 ms | 238 ms | still misses 100 ms — see finding 8 |
| F3 (20×100k) zoom p95 | 122 ms | 116 ms | |
| F2 (small data) | unchanged | unchanged | below threshold, behavior identical |

Two NEW root causes surfaced (and verified in code), now the booked queue:

7. **`_detect_layout` numeric scoring dominates import wall time**: ~9 s of
   14.6 s profiled calls `float()` per cell across all 8M cells just to find
   the header/data-start row — same per-token class, but inside delicate
   layout-detection logic, so it was deliberately NOT touched in the
   tokenizer fix.
8. **Committed zoom rebuilds the whole plot**: `args.xLim`/`args.yLim` are
   reactive deps of the uPlot create/destroy effect
   (`PlotViewport.tsx`), so every zoom that commits view limits tears down
   and reconstructs the instance — which is why an 85× point reduction only
   moved zoom p95 259→238 ms. Fix shape: apply lim changes via `u.setScale`
   on the live instance; rebuild only on structural change.

## Third fix — 2026-07-26, viewport rebuild eliminated (`bcbfb2e`)

Committed view limits now apply via `u.setScale` on the live instance
(no-op when the gesture already painted them); only autoscale (null)
transitions still rebuild, because a concrete lim is a static range tuple
in opts while null is a range function/absent — inexpressible via setScale.

| Metric | Before | After | Verdict |
|---|---|---|---|
| F1 (1M×7) zoom median/p95 | 106 / 238 ms | 98.5 / **112 ms** | −53 %, misses target by 12 ms |
| F3 (20×100k) zoom median/p95 | — / 116 ms | 66 / **86 ms** | **meets <100 ms** |
| Pan (both) | ~50 ms | ~50 ms | unaffected |

The F1 residual (~112 ms p95) is downstream of `setScale`'s own redraw —
plausibly the canvas line-draw of ~82k decimated points × 7 series under
HEADLESS/software-rendered Chromium. Per the "book only on evidence" rule,
no further work is booked: re-measure on a real-GPU interactive session
first (the harness renders without hardware acceleration, so 112 ms is
likely an overestimate of what the owner would feel).

## Fourth fix — 2026-07-26, layout-detection scoring vectorized (`9f12216`)

`_detect_layout` scored every row eagerly with per-cell `float()`; scoring
is now lazy (the header scan stops at its decision point — proven a pure
laziness refactor by a differential test against the old eager algorithm)
and chunk-vectorized for full-scan files. `delimited.py` split to
`io/_delimited_layout.py` (hdf5-precedent split).

| Metric | Before | After |
|---|---|---|
| `_detect_layout` isolated, 1M×8 | 1,328 ms | **48 ms** (27.9×) |
| End-to-end 1M×8 import wall | ~7 s | **4.72 s** |
| Import peak memory | 869 MB | 869 MB (CPU fix, unchanged) |

## Long-operation feedback/cancel audit — 2026-07-26

The P0.4 acceptance criterion "operations >500 ms have busy/progress
feedback; safe long jobs offer cancellation" was audited (static + live app
observation). Verdict: **not met** — full inventory and ranked gaps are
booked under plan P3.4. Structural facts: the job queue
(`routes/jobs_api`, poll-based ~1 s GET — not WebSocket) has exactly ONE
producer (the DREAM/bumps fit, which is also the only operation with a
progress bar and working cancel); every other candidate is a bare fetch;
`AbortController` appears nowhere in the frontend. Worst gaps by pain:
(1) file import — 14–28 s at 1M rows with only a static status-bar
sentence, import button never disabled, no cancel; (2) every
command-palette export — fully fire-and-forget, zero in-flight signal;
(3) workspace open — completely silent synchronous `JSON.parse`.

## Large derived workspace + 1M worksheet — 2026-07-26 (`be40a69`)

The remaining locally-measurable residuals, measured in one real session:
20 datasets (one 1M×8), a corrections chain + formula column + real curve
fit layered on one dataset, 11 plot windows (one on the 1M member). Run
branched just before `9f12216` merged, so its upload number predates the
layout-scoring fix; all other numbers are unaffected by that change.

| Measurement | Value |
|---|---|
| Session build total (imports + derived + 11 windows) | 22.3 s |
| JS heap after session | 1,016 MB (5 MB at start) |
| Worksheet mount @ 1M rows | 1,580 ms |
| Worksheet DOM (before AND after scroll) | 39 rows / 351 cells — bounded |
| Worksheet scroll median / p95 | 50 / 51 ms — meets <100 ms |
| `.dwk` serialize / size | 641 ms / **188 MB** |
| Autosave at this scale | **SUCCESS** — ~17 ms write behind the 800 ms debounce; IndexedDB accepted the full 188 MB, no quota failure |
| Reopen restore / **main-thread freeze** | 5,972 ms / **5,832 ms frozen** (synchronous `JSON.parse`) |
| Reopen integrity | 20/20 datasets, 11/11 windows, derived value exact round-trip, 1M rows intact |

Findings:

9. **Worksheet virtualization and autosave hold at 1M-row scale** —
   bounded DOM, in-budget scroll, and a 188 MB IndexedDB write that just
   works. No work booked here.
10. **The `.dwk` reopen path freezes the renderer for ~5.8 s** at a 188 MB
    workspace — the synchronous `JSON.parse` the feedback/cancel audit
    flagged, now measured. This is hard evidence for P3.4 slice 3 (busy
    state + move the parse off the main thread) and a data point for
    P1.2's chunked/binary-container consideration for large members.

## Residuals (explicitly unmeasured — carry in P0.4)

- Browser-side 2-D map rendering/interaction at 1000²–2000².
- Network/offline source transitions — unmeasurable today: no offline-vs-
  deleted distinction exists until P1.1 ships. Re-measure after P1.1.
- Copy/export timing at the 1M scale from the UI.
- Real-GPU F1 zoom acceptance (owner hardware; headless run reads 112 ms).
- ~~Worksheet-GRID interaction at 1M rows~~ / ~~`.dwk` with a 1M-row
  member~~ — MEASURED 2026-07-26, see above.
