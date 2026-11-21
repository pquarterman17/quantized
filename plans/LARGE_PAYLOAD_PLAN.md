# Large-payload plan: analysis responses at 200k-1M rows

The plot-series path already decimates on the server (`calc/decimate.py`,
`/api/plot/series`, the gapped `kept` payload). The analysis endpoints did
not: a large-data audit at 200k rows saw responses up to 82 MB inlined into
the client. This plan measures them, sets one rule for all of them, and
records which part has shipped.

**Status:** Active (phases 1-2 and the backend of 4 shipped, phase 3 open)
**Parent:** MAIN_PLAN.md
**Created:** 2026-11-21
**Updated:** 2026-11-21

---

## Measurement (2026-11-21, lane P4)

Synthetic CSVs (`x, y1, y2, y3`; a Gaussian peak on a slope plus noise), the
request bodies the UI builds, posted through `TestClient`. Sizes are the JSON
bytes on the wire. Script: a throwaway in the lane's scratchpad (not kept;
the size-bound tests below are the durable check).

| Endpoint (UI caller) | 200k req / resp | 1M req / resp |
|---|---|---|
| `/api/parsers/upload` (import, 4 channels) | 9.8 / 10.2 MB | 49.0 / 51.0 MB |
| `/api/fitting/fit` Gaussian (Curve Fit, batch fit) | 7.7 / 8.0 MB | 38.6 / 39.9 MB |
| `/api/fitting/equation/fit` | 7.7 / 7.5 MB | 38.6 / 37.6 MB |
| `/api/fitting/diagnostics` (Diagnostics, Q-Q plot) | 7.8 / 7.6 MB | 39.0 / 38.1 MB |
| `/api/fitting/bands` (256-point grid) | 0.01 / 0.03 MB | 0.01 / 0.03 MB |
| `/api/baseline/estimate` (SNIP) | 7.7 / 3.5 MB | 38.6 / 17.7 MB |
| `/api/baseline/modpoly` | 3.9 / 3.8 MB | 19.5 / 18.8 MB |
| `/api/peaks/find` (`background` array) | 7.7 / 3.7 MB | 38.6 / 18.4 MB |
| `/api/peaks/fit` | 7.7 / 0.004 MB | 38.6 / 0.004 MB |
| `/api/transform/sigop` median (2 channels) | 12.0 / 7.7 MB | 59.8 / 38.6 MB |
| `/api/stats/descriptive` | 3.9 / 0.001 MB | 19.5 / 0.001 MB |
| `/api/statplots/histogram` | 3.9 / 0.01 MB | 19.5 / 0.02 MB |
| `/api/plot/series` (reference, decimated) | 12.0 / 0.2 MB | 59.8 / 0.2 MB |

Derived columns (`lib/formula*`) and workspace save/load (IndexedDB / the
desktop file) never reach the server; their cost is client memory, not wire
bytes. The 82 MB of the audit is the import response at ~7 channels.

**Responses >= 5 MB at 200k:** import, fit, equation fit, diagnostics, sigop
(and at 1M also SNIP, ModPoly and peak find). **Full data posted back to a
server that already holds it:** every endpoint above posts `x`/`y` the
client sliced from a dataset the server cached at import (`X-Dataset-Handle`);
`/diagnostics` posts back `y` and the `residuals` the fit just returned;
`/bands` posts back a weighted fit's `obsVar`; `/peaks/fit` posts back the
`background` `/peaks/find` returned.

## The rule

1. **Numbers never shrink.** Parameters, errors, covariances and every
   statistic are computed on every point and are byte-identical whatever the
   display budget. Only display arrays may shrink.
2. **Display arrays come back to a pixel budget** through `calc/decimate`
   (the same per-bucket min/max the plot uses), asked for by the client with
   a point-count field. No budget = full resolution, so every existing
   caller's response is unchanged.
3. **Full resolution stays server-side, fetched by id.** A result the client
   may need again at full resolution (Freeze, write-to-sheet, export, a
   follow-up statistic) is kept in a bounded LRU store in `routes/` under a
   random id; follow-ups send the id. A miss is HTTP 409 and the client
   resends what it holds (the `_datasetcache` contract), so an evicted id or
   a restarted server is never wrong data.
4. **Redundant arrays are rebuilt, not shipped.** An array the client can
   derive bit for bit (one IEEE-754 operation on doubles it already has) is
   left off the wire.
5. **Ids instead of arrays** where the server holds the data: dataset
   handles plus a row selection for analysis inputs (phase 3).

Layering is unchanged: the stores and the opt-in fields are transport
(`routes/`); `calc/` stays pure and golden parity is untouched (no formula
changes; the replicate-vs-delegate choices are unaffected).

## Phase 1: fit residuals and diagnostics (shipped)

- `return_residuals: false` on `/fit` and `/equation/fit`
  (`routes/_fit_options.FitOptions`): the body drops `residuals` (exactly
  `y - yFit` in `calc.fitting.curve_fit`) and gains `resultId`; the full `y`,
  residuals and the fit's resolved weights stay in `routes/_fitresults.py`
  (16 entries / 192 MiB, LRU). The client rebuilds the residuals
  (`lib/fitResiduals.ts`) for every consumer (write-to-sheet, report,
  residual plots). Curve Fit and the equation fit opt in; the eager
  `recalcFits` and batch-fit callers keep the full response for now.
- `/diagnostics` takes `result_id` (+ `use_weights`) instead of the arrays,
  and `qq_points` thins the Q-Q pairs to the small plot's budget (512). The
  Diagnostics panel asks for 1 (it shows no Q-Q). The client falls back to
  the arrays on a 409 (`lib/api/fitDiagnosticsFor.ts`).
- Tests: `tests/test_api_fit_lean_payload.py` (size bounds that failed
  before the change, lean-vs-full identity, by-id-vs-by-array identity,
  `yFit` full length, 409, the store bound) and the frontend's
  `fitResiduals.test.ts` / `fitDiagnosticsFor.test.ts`.

## Phase 2: the fit curve itself (shipped)

- `display_points` (with `return_residuals: false`) on `/fit` and
  `/equation/fit`: the body drops `yFit` and a weighted fit's `obsVar` too
  and returns `yFitDisplay` = `{rows, y}`, the curve's per-bucket min/max
  rows plus the edges of every non-finite run
  (`calc.decimate.display_row_indices`). The store keeps the posted `x`, the
  full `yFit` and `obsVar` under the same `resultId` (residuals are now
  derived as `y - yFit`, the same doubles). Without `return_residuals: false`
  the field is ignored: old requests are byte-identical.
- `/api/fitting/curve` returns the full `yFit` (and `obsVar`) by id;
  `/bands` takes `result_id` for `x_data` + `obs_var`. A miss is 409, and the
  client falls back once: the curve is the model evaluated at its own x
  (`/bands`, covar null -- the same `evaluate` on the same doubles, so
  bit-identical, tested), the band resends the fit's weights (`obs_dy` /
  `obs_weights`) and s² (`obs_scale`), from which the route rebuilds obsVar
  with curve_fit's own `observation_variance`.
- Cache red-team: an id names one immutable entry, written once by the fit
  that created it (request arrays + its own outputs); no content key, so two
  fits can never alias. The client checks the returned length against the
  rows it mapped the fit onto; a saved figure re-validates its rows key
  before it uses the id.
- Client (`lib/fitCurve.ts`, lazy): a Curve Fit of more than 20,000 points
  asks for 4096 display points. The overlay (`FitOverlay.full`) draws the
  display rows with `undefined` between them (uPlot draws across; a gap is
  still NaN/null). Full resolution through one accessor family:
  `fullFitCurve` / `fullFitResult` (write-to-sheet, fit report, residual
  plots, diagnostics fallback, the status line's runs test) and
  `fullFitOverlay`, which `store/fitOverlayUpgrade.ts` swaps into the slot
  before an export / copy / send (`lib/exportActive`) and Snapshot to New
  Window. The band covers every fitted row, so an export has it in full.
  Batch fit asks for a 16-point display (it reads parameters and statistics
  only). Small fits keep the phase-1 lean response.
- Workspace: a figure document saves a display curve as what it draws plus
  `full` (id, model, parameters, run-length fitted rows, real-gap rows);
  `fitFromDocument` restores the same display curve with x re-read from
  the rows. A reopened project's id is unknown to the new server, so the
  first full-resolution use evaluates the model (bit-identical). Sections
  saved before (full `y`, no `full`) restore exactly as before.
- Tests: `tests/test_api_fit_display_curve.py` (size bounds, identity, the
  by-id and fallback curves and bands, 409s, gap edges; 7 of its 9 failed
  before the change), `fitCurve.test.ts`, `useCurveFit.display.test.ts`,
  `fitOverlayUpgrade.test.ts`.

Deferred from phase 2:

- **Recompute callers** (`store/recalcFits`, `lib/fitRecompute`,
  `store/curveFitRefit`, the pipeline and gadget fits) still take the full
  response: they are eager or write the overlay in place, and moving them
  needs the eager budget.
- **Equation fits** accept `display_points` but the client does not opt in:
  `positive_even_params` flips a sign-ambiguous parameter after the fit,
  and `f(x, -p)` is equal only to 1e-9, not bit-identical, so the evaluate
  fallback could differ from the stored curve.
- **Document-only exports** (a Figure Page panel, batch / Library PDFs) of a
  saved DISPLAY curve leave the fit out with the existing "saved fit left
  out" notice instead of shipping the thinned picture; materializing those
  sections needs an async seam in `lib/figureSpec`.
- **Zoom detail** of the display curve (it is 4096 buckets over the whole
  fit; a zoomed view shows the coarser polyline) and a decimated residual
  display (residual plots fetch the full curve when opened).
- The Curve Fit header's poor-fit verdict reads `residuals` synchronously,
  so for a display result in 0.5 <= R² < 0.9 it judges by R² only (the
  status line fetches and runs the test).

## Phase 3: inputs by dataset handle (open)

Send `dataset_handle` + channel keys + a run-length row selection instead of
`x`/`y` (38.6 MB per 1M-row fit request). Needs the per-series-X, gap-drop
and analysis-selection rules mirrored server-side, with a parity test per
rule.

## Phase 4: baselines, peaks, signal ops (backend shipped, client partly)

SNIP/ModPoly/peak-find backgrounds and sigop results are DATA (subtracted,
written to a new worksheet), so they are never decimated: the response carries
a preview display plus an id, and the full result is fetched by id once, when
it is committed (`routes/_arrayresults.py`; its docstring has the cache
red-team: one immutable entry per call, random id, `kind` checked, and a
find's background used against posted data is additionally bound to a
fingerprint of the exact x/y it was computed from).

API (all opt-in; a request without the new fields is byte-identical, tested):

- `/api/baseline/estimate` and `/modpoly`: `return_baseline: false` drops
  `baseline` (ModPoly keeps `info`) and returns `resultId`; `display_points`
  adds `baselineDisplay` = `{rows, y}`.
- `/api/peaks/find`: `return_background: false` (+ `display_points`) the same,
  as `background` / `backgroundDisplay`. `/api/peaks/fit` takes
  `find_result_id` instead of the re-posted `snip_bg` (409 when unknown, of
  another kind, or the posted x/y differ from the find's; `snip_bg` wins when
  both are sent).
- `/api/transform/sigop`: `return_dataset: false` returns `dataset` as its
  header (empty `time`/`values`), `resultId`, and with `display_points`
  `datasetDisplay` = `{rows, time, values}` (union of every channel's rows).
- New `/api/results/array` (`kind` baseline | background) and
  `/api/results/dataset`: the kept result exactly as the full response
  carried it; 409 `unknown_result` on a miss. Store: 16 entries / 256 MiB LRU.

Client (lazy): `lib/api/resultArrays.ts` (`arrayByIdOr` re-runs the same
request with the full response on a 409: the calc is deterministic, so
bit-identical) and the baseline workshop (`baselineCall.ts`): a SNIP/ModPoly
estimate of more than 20,000 rows asks for the lean response, draws the
display and fetches the full baseline by id on Subtract. Batch apply keeps the
full response.

Measured (synthetic Gaussian on a slope + noise, `TestClient`, JSON bytes,
4096 display points):

| Call | 200k req / resp (before -> after) | 1M req / resp (before -> after) |
|---|---|---|
| `/baseline/estimate` SNIP response | 7.7 / 3.68 -> 0.20 MB | 38.5 / 18.41 -> 0.21 MB |
| `/baseline/modpoly` response | 3.9 / 3.67 -> 0.20 MB | 19.3 / 18.35 -> 0.21 MB |
| `/peaks/find` response | 7.7 / 3.66 -> 0.20 MB | 38.5 / 18.29 -> 0.21 MB |
| `/peaks/fit` request (find id vs `snip_bg`) | 11.57 -> 7.71 MB | 57.83 -> 38.54 MB |
| `/transform/sigop` response (2 channels) | 11.35 -> 0.52 MB | 56.77 -> 0.52 MB |
| commit: full result by id (once) | 3.68 / 11.35 MB | 18.41 / 56.77 MB |

The `/peaks/fit` request still carries x/y (phase 3 removes those: a dataset
handle + row selection). The id removes the background, one third of it.

Tests: `tests/test_api_large_results.py` (5 of its 8 failed with the route
changes reverted: lean SNIP, lean ModPoly, find + fit by id, the 409 cases,
lean sigop), `baselineCall.test.ts`, `resultArrays.test.ts`.

Deferred from phase 4:

- **Peak find / peak fit clients**: `usePeaks` keeps the full `background`
  (curation, `detectedPeakCuration`, the saved peak table read it
  synchronously) and its `fitPeak` calls never sent `snip_bg`, so the
  `find_result_id` path has no UI consumer yet.
- **Sigop preview client**: `computeSigop` serves both the live preview and
  the commit/replay path and the preview consumes the whole dataset; opting
  the preview in needs the workshop to render `datasetDisplay`.
- **Other baselines** (ALS, rolling ball, anchor, Shirley, region): same
  shape, one wrapper each; the lean fields exist only on SNIP and ModPoly.
- **Recipe / wizard callers** (`peakwizard/recipeSteps`) and batch apply keep
  the full response.

## Completed

- 2026-11-21: phase 4 backend + baseline workshop (lean SNIP/ModPoly, lean
  peak find, lean sigop, `/api/results/*`, `find_result_id` on `/peaks/fit`);
  measurements in the phase 4 section.

- 2026-11-21: phase 2 (display-curve fits, full curve and obsVar by id, the
  eviction fallbacks, display sections in figure documents). Measured after,
  same synthetic data (Gaussian, 4096 display points):

  | Response / request | 200k before -> after | 1M before -> after |
  |---|---|---|
  | `/fit` response (lean -> display) | 4.28 -> 0.12 MB | 21.41 -> 0.12 MB |
  | `/fit` weighted response | 8.04 -> 0.12 MB | 40.20 -> 0.12 MB |
  | `/bands` weighted request | 7.40 MB -> 5.0 kB | 36.98 MB -> 5.0 kB |
  | full curve when needed (`/curve`) | -- -> 4.28 MB | -- -> 21.40 MB |

- 2026-11-21: measurement table; phase 1 (lean fit residuals, diagnostics by
  result id, thinned Q-Q). Measured after, same script:

  | Response | 200k before -> after | 1M before -> after |
  |---|---|---|
  | `/fit` Gaussian | 7.98 -> 4.28 MB | 39.90 -> 21.41 MB |
  | `/equation/fit` | 7.53 -> 3.71 MB | 37.64 -> 18.54 MB |
  | `/diagnostics` request | 7.79 MB -> 0.1 kB | 38.95 MB -> 0.1 kB |
  | `/diagnostics` response, panel / Q-Q plot | 7.63 MB -> 0.5 / 40 kB | 38.13 MB -> 0.5 / 40 kB |
