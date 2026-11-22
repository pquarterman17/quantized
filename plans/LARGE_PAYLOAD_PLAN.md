# Large-payload plan: analysis responses at 200k-1M rows

The plot-series path already decimates on the server (`calc/decimate.py`,
`/api/plot/series`, the gapped `kept` payload). The analysis endpoints did
not: a large-data audit at 200k rows saw responses up to 82 MB inlined into
the client. This plan measures them, sets one rule for all of them, and
records which part has shipped.

**Status:** Active (phases 1-2, the backend of 4, the phase 3 slice, the P8 input consumers and lane D's remaining inputs, weights by channel and lean baselines shipped)
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

## Phase 3: inputs by dataset handle (slice shipped)

Send `dataset_handle` + channel keys + a run-length row selection instead of
`x`/`y` (38.6 MB per 1M-row fit request).

Design (lane P7):

- **The server already holds the data.** `routes/_datasetcache.py` keeps the
  decoded DataStruct under its content hash; the import routes cache what
  they parse and send `X-Dataset-Handle`, every plot fetch names the dataset
  by that handle, and the client remembers handle per DataStruct object
  (`lib/api/datasetCache.ts`, a WeakMap). No new upload step is needed: the
  existing upload-once/409-resend path is reused as is.
- **Wire shape** (`routes/_datasetrows.XYSource`, opt-in on `/api/fitting/fit`
  and `/api/peaks/fit`): `dataset_handle` (or, after a 409, the full
  `dataset` once), `x_channel` / `y_channel` (-1 = time) and `rows` as
  ascending, disjoint `[start, count]` runs. Send these OR `x`/`y`; mixing is
  422. Without them the request and response are exactly as before.
- **The rules stay on the client; the selection is their output.** The plan
  first said to mirror the per-series-X, gap-drop and analysis-selection rules
  server-side. That was rejected: the inputs of those rules are client state
  (manual exclusions, the Data Filter predicate evaluated in JS, a selection's
  row ids and X range, column designations), which would have to be sent
  anyway, and two implementations of a rule drift. The client resolves them
  exactly as before (`selectedFitData` + `dropGapRows` + `fitRowsOf`) into the
  X channel and the fitted rows; the server only gathers. What the server
  mirrors is the ARRAY ENCODING, so it gathers the doubles the array path
  would have parsed: a non-finite gathered value is 422 (JSON cannot carry
  one, so no array request could hold it), and `-0` is written `+0`
  (`JSON.stringify(-0)` is `"0"`). Parity is tested per rule on both sides.
- **Cache red-team.** The gathered arrays depend on: the dataset content (the
  handle IS its content hash: time, values, labels, units, metadata), the two
  channels and the rows (all in the request), and the rules (their output is
  the rows/channel). Nothing is stored under a key of this module's own. The
  one trust edge is the client's WeakMap (object -> handle): a DataStruct is
  immutable per load (a cell edit or reimport makes a new object), the same
  invariant every plot fetch already relies on.
- **Fallback.** Only a dataset with a remembered handle goes by handle (an
  upload merely in flight may end without one); otherwise the arrays are
  posted (a first upload of every channel costs more than x/y). An
  unknown/evicted handle is 409 and `postJSONDatasetAware` resends the
  dataset once in the same request; the route caches it and a successful
  response carries the new `X-Dataset-Handle`. If the resend is refused too
  (413: a dataset wider than the body cap; or a second 409) the client posts
  the arrays, so the worst case is the request as it always was.
- **Client** (lazy `lib/fitSource.ts`): Curve Fit's single-dataset fit
  (`displayFit` with a `FitSource`) and the Peaks workshop's "Fit each"
  (`peakInputs` now returns the dataset `rows` of its pairs). Weighted fits
  still post `dy`/`weights` over the fitted rows.

Measured (synthetic Gaussian on a slope + noise, JSON bytes as sent, lean
fit with 4096 display points; parameters identical on every row):

| Request | 200k before -> after | 1M before -> after |
|---|---|---|
| `/fitting/fit`, no gaps | 7.31 MB -> 168 B | 36.54 MB -> 169 B |
| `/fitting/fit`, 1% random gap rows | 7.24 MB -> 23.0 kB | 36.17 MB -> 121.9 kB |
| `/peaks/fit` (per peak), no gaps | 7.31 MB -> 174 B | 36.54 MB -> 175 B |
| `/peaks/fit` (per peak), 1% gaps | 7.24 MB -> 23.0 kB | 36.17 MB -> 121.9 kB |

Server time for the same fit is unchanged or lower (1M: 5.5 s -> 4.5 s,
`json` decode of the arrays saved). A random-gap worst case (every other row
a gap) is 5.4 MB of runs at 1M, against ~18 MB of x/y for the 500k pairs left.

Tests: `tests/test_api_fit_by_handle.py` (per rule, full and display
responses byte-identical to the array fit; weighted; `/peaks/fit`; -0; size;
409 + resend; the 422 guards) -- 26 of its 29 failed with the route changes
reverted (the 3 that passed: the size arithmetic, missing-x/y 422, the run
expander); `test_routes_malformed_dataset.py` sweeps both routes. Frontend: `useCurveFit.bySource.test.ts` (per rule, the rows sent
gather to the posted x/y as JSON; the X channel; arrays without a handle;
409 then one resend, then the earned handle; a refused resend posts the
arrays), `peakInputs.rows.test.ts` (per rule incl. the fallback channel),
`usePeaks.bySource.test.ts`; the 8 call-site tests failed with `fitCurve.ts` /
`usePeaks.ts` reverted. `/fitting` and `/peaks` now decode bodies off the
event loop (`OffloopJSONRoute`, required for a dataset-bearing route).

Deferred from phase 3:

- ~~**Other inputs**~~ Done: `/autoguess`, `/equation/fit` and `/peaks/find`
  went by handle in P8; `/peaks/fit-multi`, every baseline route, sigop and
  `/stats/descriptive` + `/stats/regression` in lane D (below). Still arrays:
  the other stats routes (their `x`/`y` are independent samples, not rows of
  one dataset) and the peak-integrate / batch routes.
- ~~**Weights by channel**~~ Done in lane D (below), for the error-column and
  direct-weight modes; the derived Poisson vector still rides as an array.
- **Recompute callers** (`recalcFits`, pipeline/gadget fits) keep posting
  arrays (eager modules; the eager budget has ~0.5 kB). The batch Curve Fit
  went by handle in lane DF (below).
- **A subset fit's own row-identity write** gives the worksheet a new data
  object (`bindFitRowIdentity` writes metadata), so the NEXT fit of it posts
  arrays until a plot fetch earns the new object a handle.
- `/peaks/fit` refuses `find_result_id` with a row selection (422): its 409
  would be indistinguishable from a handle miss. A by-handle find id needs a
  distinct miss detail first.

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
  `find_result_id` path has no UI consumer yet. P8 checked this and left the
  lean response off (see the P8 section).
- **Sigop preview client**: `computeSigop` serves both the live preview and
  the commit/replay path and the preview consumes the whole dataset; opting
  the preview in needs the workshop to render `datasetDisplay`.
- ~~**Other baselines** (ALS, rolling ball, anchor, Shirley, region)~~ Done in
  lane D: every baseline route has the lean fields, and the workshop's
  preview uses them for all methods.
- **Recipe / wizard callers** (`peakwizard/recipeSteps`) and batch apply keep
  the full response.

## P8: the cheap input consumers (shipped)

`routes/_datasetrows.XYSource` is now also the request base of
`/api/fitting/autoguess`, `/api/fitting/equation/fit` and `/api/peaks/find`
(`routes/fitting.py`, `routes/peaks.py`; each route calls `source_xy` and
returns the same body). Opt-in: a request with `x`/`y` is byte-identical and
sends no `X-Dataset-Handle` (tested), mixing is 422, a miss is 409.

- **Guess and the data-derived starts** (`lib/fitCurve.autoGuessFor`): Curve
  Fit's Guess button and `parseFitStarts` (an edited table's blank starts) send
  the handle + channels + the fit's own rows. The batch keeps arrays (it fits
  by arrays, a deferred recompute caller).
- **Equation fit** (`lib/fitSource.leanEquationFit`): input by handle only. The
  display-curve opt-in stays off: it is blocked by `positive_even_params`
  (phase 2 deferral), which does not touch the input side.
- **Peaks find**: `usePeaks` finds by handle. The lean background
  (`return_background: false`) stays OFF: `detectedPeakCuration.manualPeakAt`
  reads `data.background` synchronously (it snaps a manual peak against
  `y - background`), and the saved peak table and its overlays read it too, so
  the full array is needed the moment the find returns. `/peaks/fit`'s
  `find_result_id` still has no consumer: "Fit each" never posted `snip_bg`
  (the fit computes its own SNIP), so passing the find's background would
  change the fit, not just the transport. Left as is on purpose.
- **Sigop preview: skipped.** `useSigopRun` feeds one `SigopComputed` (the full
  dataset) to `SigopBody`, `ReduceXYSection` and `SignalPreview`, and the commit
  runs `runTransform`, which calls `computeSigop` again (one undo entry, one
  pipeline step). Rendering `datasetDisplay` and committing from the preview's
  id means a lean `SigopComputed`, a new commit seam through `transformRun` and
  its replay path, and a changed readout contract in two workshops: a workshop
  redesign, not a contained change.

Measured (synthetic Gaussian on a slope + noise, 1M rows, `TestClient`, JSON
bytes as sent; responses unchanged and identical, `resultId` aside):

| Request | 1M before -> after | Response |
|---|---|---|
| `/fitting/autoguess` | 36.67 MB -> 122 B | 0.1 kB |
| `/fitting/equation/fit` (lean) | 36.67 MB -> 192 B | 18.49 MB (display curve not opted in) |
| `/peaks/find` (lean) | 36.67 MB -> 151 B | 0.21 MB |

Server time: guess 1.5 s -> 0.1 s (the JSON decode was most of it), equation
fit 11.7 s -> 9.6 s, peak find 206 s both ways (the detector's own cost at 1M
rows, unrelated to transport).

Tests: `tests/test_api_handle_inputs.py` (per client rule x route, byte
identical to the array request; weighted and blank-start equation fits; lean
find id bound to the gathered x/y; 409 + resend; the 422 guards; size) and the
three routes in the malformed-dataset sweep. 59 of the 66 failed with the route
changes reverted (the 7 that passed: missing-x/y 422s and the size arithmetic).
Frontend: `useCurveFit.guessBySource.test.ts`, `fitStarts.bySource.test.ts`,
`usePeaks.bySource.test.ts` (find case): 8 of 11 failed with the call sites
reverted (the 3 that passed: the 409 fallback, the arrays without a handle and
the existing "Fit each" case).

Deferred from P8:

- **Equation fit display curve** (see phase 2) and the peak-find lean
  background / `find_result_id` consumer (above): both need a design change,
  not a transport one.
- **Sigop preview** by `datasetDisplay` (above). (Sigop / baseline / stats
  inputs by handle: done in lane D.)
- ~~**Batch Curve Fit** guesses and fits still post arrays.~~ Done in lane DF:
  the per-worksheet batch fit and its data-derived starts go by handle. Still
  arrays: the factor-level path (each level is a new in-memory object with no
  handle) and `recalcFits` / `fitRecompute` (eager).

## Lane D: remaining inputs, weights by channel, lean baselines (shipped)

All opt-in; a request in the old shape is byte-identical (tested, no handle
header). Backend `routes/_datasetrows.py` now has `YSource` (y-only: ALS,
rolling ball, ModPoly) and `XSource` (descriptive; gaps stay NaN, as a posted
`null` does) next to `XYSource`; `/baseline`, `/stats` get the offloop route
class like `/fitting`.

- **Inputs by handle**: `/peaks/fit-multi`, `/baseline/{estimate, als,
  rollingball, modpoly, anchor, shirley, xrdlowangle, region}`,
  `/stats/regression` and `/stats/descriptive` take `dataset_handle` +
  channels + `rows` (409 on a miss, then one resend of the dataset, then the
  arrays). `/transform/sigop` takes `dataset_handle` instead of `dataset`
  (a posted `dataset` wins, is not cached and sets no header, so the old
  request is untouched); the cached dataset is read as JSON would have carried
  it (`json_equivalent`: -0 -> +0, Inf -> NaN), tested with -0, Inf and NaN.
- **Weights by channel**: `dy_channel` (= `|column|`, `dyForFit`'s yerr and
  manual modes) and `weights_channel` (the column as is, direct mode) on
  `FitOptions`, so `/fitting/fit` and `/equation/fit`; read at the same rows
  as x/y, a non-finite weight is 422, with posted x/y or together with
  `dy`/`weights` is 422. The client (`lib/fitSource.weightColsOf`) uses it
  whenever `dyForFit` resolved a vector from a column; the Poisson vector
  (sqrt of y) is derived and still posts. `scale_errors` stays in the body.
- **Lean baselines**: `return_baseline: false` / `display_points` on ALS,
  rolling ball, anchor, Shirley, XRD low-angle and region (region's polynomial
  comes back as `baselineDisplay`, its other fields unchanged); the full
  result is `/api/results/array` by id as for SNIP/ModPoly.
- **Client** (all lazy; eager size unchanged, see the commit): the baseline
  workshop (`baselineCall.ts`: every method by handle, lean for every method
  over 20,000 rows), Peaks "Fit simultaneously", Fit Y by X's bivariate leg,
  Curve Fit and its batch (weights), sigop (`lib/api/sigopByHandle.ts`, used by
  `computeSigop` when the dataset object has a remembered handle).

Measured (synthetic Gaussian on a slope + noise, 1M rows, JSON bytes as sent;
responses identical to the array request, `resultId` aside):

| Request | arrays | by handle |
|---|---|---|
| `/peaks/fit-multi` | 38.67 MB | 191 B |
| `/baseline/estimate` (SNIP) | 38.67 MB | 129 B |
| `/baseline/als` | 19.49 MB | 94 B |
| `/baseline/rollingball` | 19.49 MB | 108 B |
| `/baseline/modpoly` | 19.49 MB | 94 B |
| `/baseline/anchor` | 38.67 MB | 167 B |
| `/baseline/region` | 38.67 MB | 152 B |
| `/stats/regression` | 38.67 MB | 123 B |
| `/stats/descriptive` | 19.49 MB | 94 B |
| `/transform/sigop` (2 channels) | 60.18 MB | 117 B |
| `/fitting/fit`, weighted, display curve (x/y/dy) | 58.18 MB | 200 B (`dy_channel`) |

The weights alone were the remaining ~19.5 MB of a by-handle weighted fit
(`dy` as an array); `dy_channel` removes it. Lean responses at 1M rows:

| Response | full -> lean |
|---|---|
| `/baseline/als` | 18.55 -> 0.21 MB |
| `/baseline/rollingball` | 18.55 -> 0.21 MB |
| `/baseline/anchor` | 18.45 -> 0.21 MB |
| `/baseline/region` | 18.46 -> 0.21 MB |
| `/baseline/shirley` | not measured at 1M (the synthetic peak has no step, so Shirley refuses it); identical-by-id covered at 30k rows |

Tests: `tests/test_api_handle_inputs_more.py` (per client rule x route,
byte-identical to the array request; weights by channel for dy/|negative|/
weights x 4 rules x /fit and /equation/fit; sigop incl. -0/Inf; lean x5; 409,
422 and size guards) -- 108 of its 109 failed with the route changes reverted
(the 1 that passed is the size arithmetic). Frontend: `baselineCall.bySource.test.ts`,
`useCurveFit.weightCols.test.ts`, `CurveFitBatchSection.bySource.test.tsx`,
`runLeg.bySource.test.ts`, `usePeaks.bySource.test.ts`, `sigopByHandle.test.ts`
-- 35 of the 41 call-site tests failed with the call sites reverted.

Deferred from lane D:

- The other `/stats` routes (t-tests, two-sample, correlation, ...): their
  `x`/`y` are independent samples or derived arrays, not one dataset's rows;
  the distribution workshop and the eager `statsDescriptive` callers post
  filtered arrays (no row identity), so descriptive has no client yet.
- Sigop preview stays arrays unless the dataset object has a handle (the
  analysis rows of an excluded/filtered sheet are a new object); a 409 resend
  posts the whole held object, as the fits do.
- The recompute callers and `peakwizard/recipeSteps` still post arrays.

## Completed

- 2026-11-22: lane D: remaining inputs by handle (fit-multi, baselines, sigop,
  regression, descriptive), weights by channel, lean ALS / rolling ball /
  anchor / Shirley / region; measurements and tests in the lane D section.
- 2026-11-21: batch Curve Fit by handle (lane DF): `CurveFitBatchSection` posts
  `/fitting/fit` as dataset handle + channels + the fitted rows (the single
  fit's `fitRowsOf` mapping) through `postBySource`, with arrays when the
  server does not hold the worksheet; no new eager code (the section is in the
  Curve Fit workshop chunk). Test `CurveFitBatchSection.bySource.test.tsx`
  (the by-handle case failed with the call site reverted).

- 2026-11-21: P8 (lane P8): `/autoguess`, `/equation/fit` and `/peaks/find`
  take a dataset handle + channels + rows; Guess, the edited-table starts, the
  equation fit and the peak find use it when the server holds the dataset.
  1M-row requests 36.67 MB -> 122-192 B; table and the skipped / left-off items
  in the P8 section.

- 2026-11-21: phase 3 slice (lane P7): `/fitting/fit` and `/peaks/fit` take a
  dataset handle + channels + run-length rows (`routes/_datasetrows.py`);
  Curve Fit and "Fit each" use it when the server holds the dataset. 1M-row
  fit request 36.5 MB -> 169 B; table and tests in the phase 3 section.

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

## Peak-find detector time (lane PK, 2026-11-21)

`/api/peaks/find` on the 1M-row Gaussian-on-slope set (default options) was
~184-206 s, all in the detector (`calc.peaks.find_peaks_robust`), not
transport. Profile: 90%+ in `calc.baseline._snip_background`. The detector
widens the SNIP window to 5 % of the x span, so `w_max` is ~5 % of n and the
clip loop (`for w in w_max..1`, each a full-array pass) is O(n * w_max) = O(n^2).
On noisy data ~50-90 % of samples change on every step (measured), so there is
no sparse or early-exit shortcut that stays exact. The remaining stages are
linear (prominence stack ~0.3 s per 100k rows; FWHM and the matched filter run
per surviving peak).

Fix: `calc/_snip.py` runs the *same* arithmetic per element
(`min(v[i], fl(fl(v[i-w] + v[i+w]) / 2))`) without the per-step full-array
copy and temporaries: double buffer, cache-sized chunk temporary, `* 0.5` for
`/ 2.0` (identical correctly-rounded value). No summation order changed, so
output is bit-identical (peaks, heights, widths, prominence, background
compared by `repr` / raw bytes at 100k, 200k, 1M; `tests/test_calc_snip.py`
pins the kernel to the retained original loop on random, NaN/inf, flat,
plateau, edge, single-sample and chunk-seam inputs).

| Rows | Before | After | Speed-up |
|---|---|---|---|
| 100k | 1.89 s | 0.81 s | 2.3x |
| 200k | 8.04 s | 3.60 s | 2.2x |
| 1M | 184 s | 73 s | 2.5x |

(Single run each, same machine; 1M "before" is 184 s here vs 206 s measured
earlier on another box.) The cost is still quadratic.

### Compiled kernel (lane NB, 2026-11-21)

Owner-approved: `numba` (BSD; `llvmlite` BSD-2 + Apache-2.0 with LLVM
exception, no GPL; `test_no_gpl_in_runtime_deps` passes) is now a dependency.
`calc/_snip_numba.py` is the same loop compiled: same
`min(v[i], fl(fl(v[i-w] + v[i+w]) * 0.5))`, same order, double buffer, no
fastmath. An unsigned loop index over four slice views is what lets LLVM
vectorise it (a signed index measured 3x slower, scalar adds only). numba is
imported lazily through `heavy_imports`; if it cannot be imported or compiled
(no wheel, broken llvmlite, `QZ_NO_NUMBA=1`) `snip_clip` runs the numpy path
unchanged. Dispatch (`calc/_snip.py`): below `_WARM_MIN_WORK` (n*w_max =
2e7) numba is never touched; between that and `_COMPILED_MIN_WORK` (2e8) the
kernel is used only if a bigger call already loaded it; above, it is loaded
(~0.5 s one-off with the on-disk cache, ~1.5 s cold).

Same machine, default route options, default `find_peaks_robust` on the
Gaussian-on-slope set, background and peak list byte-identical to numpy in
all runs (sha1 of the background bytes and of `repr(peaks)`):

| Rows | numpy (#810) | numba (first call, incl. load) | Speed-up |
|---|---|---|---|
| 100k | 0.90 s | 0.90 s | 1.0x (SNIP 0.36 -> 0.10 s; load eats the gain) |
| 200k | 2.87 s | 1.65 s | 1.7x |
| 1M | 69.8 s | 35.7 s | 2.0x |

Kernel alone, warm: 100k rows x w_max 2500 0.36 -> 0.10 s, 200k x 5000
1.81 -> 0.57 s. At 1M the arrays (8 MB each, two buffers) leave L2 and the
kernel turns memory-bound, so the end-to-end gain is ~2x, not ~3.5x. Still
O(n * w_max). Next steps if needed: thread the inner loop (`prange`; exact,
elements are independent per window step) or a documented, non-identical
approximation (SNIP on a decimated copy). Both deferred.

bumps interplay: `bumps.dream` JIT-compiles its DE step whenever `import numba`
succeeds, onto numba's own generator that no seed reaches, which broke seeded
DREAM reproducibility (6 tests failed once numba was installed). `heavy_import`
therefore hides numba from the first import of `bumps` (under the same lock;
`test_bumps_import_does_not_see_numba`), so DREAM keeps its pure-Python path.
A bumps imported outside `heavy_import` would still pick numba up.

One caveat to "bit-identical": when two NaNs of opposite sign meet in one add
(needs +inf and -inf in the same trace, since only inf - inf makes a negative
NaN), numpy itself returns either operand's NaN depending on SIMD lane, so the
sign bit of that NaN can differ. Every non-NaN value and every NaN position is
still identical; with no -inf in the input the output is byte-exact.
`tests/test_calc_snip.py` pins both statements.
