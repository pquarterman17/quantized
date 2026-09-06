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
10. **The `.dwk` reopen path freezes the renderer for ~5.8–6.7 s** at a
    188 MB workspace. ATTRIBUTION CORRECTED 2026-07-26 (P3.4 slice 3,
    `481e0ea`): instrumentation showed the synchronous `JSON.parse` +
    validation is only **~0.4–0.6 s** of that; moving it to a worker
    (shipped, with an equivalence-tested sync fallback) swapped it for a
    comparable ~0.7–0.8 s structured-clone cost — an interleaved A/B
    measured the freeze statistically unchanged (~6.5 s both ways). The
    TRUE dominant term is **React re-render + 11-window mount + canvas
    paint (~5–6 s) after `loadWorkspace`** — booked as P3.4 slice 4
    (staged/progressive window mount on restore). The worker path still
    removes parse-time blocking that scales with file size for
    data-dominated, few-window workspaces, and slice 3's busy state means
    the wait is at least signposted now.

## Staged restore + eager-bundle boundary — 2026-07-26 late

Slice 4 (`65e3670`) stages plot-window hydration on bulk restore (active
window first, one per frame). Same-machine interleaved A/B on the 188 MB
session:

| Metric | Unstaged | Staged |
|---|---|---|
| Time-to-first-paint | 906 ms | **106 ms** (−88 %) |
| Restore wall | 8,440 ms | ~6,660 ms (−21 %) |
| Max main-thread freeze | 7,555 ms | ~5,750 ms (−24 %) |

Findings:

11. **The <1.5 s freeze target is now gated by ONE window**: mounting a
    window on the 1M-row dataset costs ~4.5–6.3 s regardless of staging —
    while the SAME dataset's first frame on the main stage after import is
    **874 ms**. The window path is doing ~5–7× extra work somewhere;
    finding that divergence is the booked next item.
12. **Eager-bundle boundary** (`95bf0b2`): `main.tsx`'s static import of
    `CalcOnlyApp` pinned the whole DiraCulator calculator tree (69.9 kB
    minified) into eager JS — reachability from an eager root defeats
    code-splitting even when another consumer lazy-loads the same tree.
    Eager 948.4 → 881.2 kB merged; ratchet budget lowered 949.2 → 919.2 kB.
    What remains eager is dominated by react-dom + uplot + the core store;
    no further cheap boundary exists today.

## Window-mount "divergence" resolved — 2026-07-26 late (`89499cc`)

13. **The paths were never divergent code** — profiling showed both window
    and stage share the identical `usePlotPayload` → `/api/plot/series` →
    `PlotViewport` pipeline. The extra seconds were
    `channelModelingType`/`inferModelingType` + `defaultDenseChannels`
    running unmemoized in render (~14 calls × 100–300 ms on 1M rows),
    paid on every (re-)activation of a heavy dataset before the fetch
    could start. WeakMap caches on the `values` reference fixed the class
    for every consumer. Window open 6,066→~3,800 ms; restore freeze
    5,604→~3,660 ms. The measured remaining term everywhere is now the
    **78 MB `/api/plot/series` payload** (network + encode + parse,
    ~2–5 s) — server-side payload decimation is booked (it was
    pre-authorized as the second half of the original point-reduction
    item). One anomaly under investigation by the final measurement wave:
    restore TTFP varied 89 ms vs ~2,300 ms run-to-run, suspected
    save-time focused-window nondeterminism in the harness.

## Final residual wave — 2026-07-27 (`2ea1f9a`; raw: `docs/envelope/2026-07-27-final-residuals.json`)

14. **Browser 2-D maps are gated by input triangulation, not display
    resolution.** Import→map-visible: 12–13 s at 500², **52–59 s at
    1000²**; 2000² overflowed the measurement transport on a
    hundreds-of-MB import response. Isolated backend timing: the default
    linear regrid (`scipy griddata`) re-triangulates the FULL scattered
    input every call — 8.5 / 37 / 153 s at 250k / 1M / 4M points — while
    sweeping output resolution 200²→2000² moved cost <2 %. The UI's
    resolution dropdown is a red herring; RSM input is typically a
    REGULAR GRID, so a gridded-input fast path (bin/decimate, no
    Delaunay) is the booked class fix (P2.8 evidence satisfied).
15. **1M export: the backend is fine; a dialog path is broken.** "Copy
    figure" (no dialog, same render pipeline) worked 3/3 (~15 s at 1M —
    payload decimation will cut this). "Export figure…" via the dialog:
    PNG 2/3 (one hang), **SVG 0/3 — reproducible hang with ZERO network
    activity** (raw-fetch SVG works: 16.7 s, valid 1.67 MB file), so the
    fault isolates to the `askParams` → `runExportFigureCommand`
    orchestration. Also: the "Copy figure (vector)" menu item never
    renders even though the capability probe passes. Both booked as
    defects.
16. **TTFP anomaly RESOLVED**: `focusedWindowId` at save time decides
    which window staged hydration mounts eagerly; the harness now pins a
    small window before save → TTFP 4–13 ms, deterministic across runs
    (deliberately focusing the 1M window reproduces the slow case,
    317–540 ms). Freeze/restore trend continued: ~2,900–3,100 ms /
    ~3,800–4,000 ms — measured on a tree that PREDATES the memoization
    fix (`89499cc`), so current main is likely somewhat better; the
    <1.5 s target still waits on the payload-decimation item.

## Perf sweep — 2026-09-06 (PRs #295–#301)

A follow-on repo-evaluation session, outside the dated P0.4 runs above.
Each row's numbers are as stated in that PR's own commit message; where none
is stated the change is described qualitatively rather than invented. Not
every row is a P0.4 fixture-list item — the Debye fit vectorization and the
startup-import deferral are hot paths found in the same session, included
here for one dated record rather than split across files.

| PR | What changed | Before → after |
|---|---|---|
| #295 | `upload_file`/`upload_template` (`routes/parsers.py`) parsed synchronously on the event loop; moved to `run_in_threadpool`. Response encoding (`routes/_payload.py`'s `DataStructResponse`/`dumps_payload`) and the delimited-parser transpose (`io/delimited.py`) now chunk their C-level calls (~8k-element budget) so the GIL is released between chunks too. | `GET /api/health` during a 1M-row CSV upload: 15.5 s stalled (of a 16.8 s upload) → <0.5 s |
| #296 | `/api/plot/series` accepts the existing dataset-handle cache (`routes/_datasetcache.py`, `X-Dataset-Handle`) the map/RSM routes already used, so a committed zoom/pan re-fetch sends a handle instead of the whole dataset. | 1M×7 windowed re-fetch: 11.76 s → 0.31 s server wall time; request body 154 MB → 112 bytes |
| #297 | `_debye`/`_debye_einstein` (`calc/fit_models_special.py`) replaced a per-x-point `scipy.integrate.quad` loop (452k `quad` calls per default 10k-point model scan) with fixed 32-node Gauss-Legendre quadrature broadcast over the array; Einstein lattice term made overflow-safe. Max relative error vs. the old per-point implementation: 1.5e-12; golden parity unchanged. | `evaluate()` at 10k points: 116 ms → 17.5 ms; `curve_fit(Debye)` at a matched 229 iterations: 57.7 s → 7.4 s |
| #298 | `io/delimited.py`'s numeric import gets a bulk `np.loadtxt` fast path (`io/_delimited_fast.py`) gated by a start/middle/end sample of the data block (each sampled row must split to exactly `n_cols` float-parseable tokens); the full `np.loadtxt` parse then validates the complete block and any failure or shape mismatch falls back to the existing tokenize/transpose/convert path, so the fast path can never alter a result. Layout detection tokenizes lazily. | 1M×7 CSV `import_auto`: 10.25 s → 1.88 s wall, 989 MB → 546 MB peak memory; 100k-row file: 0.56 s → 0.16 s |
| #299 | `setCellValue`/`setCategoricalCell` (worksheet single-cell edits) recompute only the edited row's formula cells (`lib/formulaIncremental.ts`) instead of every formula column over every row, whenever every formula is provably row-local (falls back to a full recompute for aggregates, `lag`/`diff`, recodes, or a formula already carrying an error). | Per-edit cost at 1M rows: ~4.2 s → ~18 ms |
| #300 | `create_app()` no longer imports `openpyxl` (Excel parser) or `periodictable` (SLD formula) eagerly — both move inside the functions that use them; the Excel sniffer checks the extension instead of importing openpyxl. `PanelOverlayWindow` keys its dropped-row memo on dataset identity (`lib/rowstate.rowStateIdentity`) instead of rebuilding a full set every render. | Warm `create_app()`: 1.9–3.3 s → 1.8–2.1 s (component costs removed from startup: openpyxl ~0.2 s cold, periodictable ~0.03 s) |
| #301 | Test-only: `test_upload_concurrency.py`'s health/upload race is now forced via an `Event` gating the held parse instead of sized by a wall-clock sleep, after the 120k-row fixture parsed faster than the pre-poll sleep on a fast CI runner and the probe missed the window once. | No performance number — flake-elimination, not a re-measure |

Of these, #296 and #299 extend the original envelope directly: #296 is the
committed-zoom-refetch half of finding 1's point-reduction campaign above
(decimation shrank points-on-the-wire; the handle cache now also shrinks the
re-fetch itself for an unchanged dataset); #299 measures the worksheet's
single-cell EDIT path at 1M rows, which the 2026-07-26 large-workspace run
(`be40a69`, above) did not — that run covered mount/scroll only.

## Residuals (explicitly unmeasured — carry in P0.4)

- Network/offline source transitions — unmeasurable today: no offline-vs-
  deleted distinction exists until P1.1 ships. Re-measure after P1.1.
- Real-GPU F1 zoom acceptance (owner hardware; headless run reads 112 ms).
- 4M-point (2000²) browser map import — the measurement transport itself
  overflowed; re-attempt after payload decimation shrinks responses.
- ~~Worksheet-GRID @1M~~ / ~~big `.dwk`~~ (measured 2026-07-26);
  ~~browser maps 500²–1000²~~ / ~~1M UI copy/export~~ (measured
  2026-07-27, see §Final residual wave).
