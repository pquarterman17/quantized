# Large-payload plan: analysis responses at 200k-1M rows

The plot-series path already decimates on the server (`calc/decimate.py`,
`/api/plot/series`, the gapped `kept` payload). The analysis endpoints did
not: a large-data audit at 200k rows saw responses up to 82 MB inlined into
the client. This plan measures them, sets one rule for all of them, and
records which part has shipped.

**Status:** Active (phase 1 shipped, phases 2-4 open)
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

## Phase 2: the fit curve itself (open)

`yFit` is still full length (~19 MB of JSON at 1M rows): the fit overlay is
a full-length array in register with the dataset rows, read by ~40 modules
(plot, Freeze, figure export, recompute, analysis results, workspace). Move
the overlay to `{resultId, display}` (a decimated curve for the plot, the
full curve fetched by id for Freeze / write-to-sheet / export) behind one
accessor, then let Curve Fit ask for `display_points`. Same treatment for
`obsVar` (`/bands` by id) and batch fit.

## Phase 3: inputs by dataset handle (open)

Send `dataset_handle` + channel keys + a run-length row selection instead of
`x`/`y` (38.6 MB per 1M-row fit request). Needs the per-series-X, gap-drop
and analysis-selection rules mirrored server-side, with a parity test per
rule.

## Phase 4: baselines, peaks, signal ops (open)

SNIP/ModPoly/peak-find backgrounds and sigop results are DATA (subtracted,
written to a new worksheet), not display, so they need phase 2's by-id
pattern rather than plain decimation; `/peaks/fit` should take the find
result's id instead of `snip_bg`.

## Completed

- 2026-11-21: measurement table; phase 1 (lean fit residuals, diagnostics by
  result id, thinned Q-Q). Measured after, same script:

  | Response | 200k before -> after | 1M before -> after |
  |---|---|---|
  | `/fit` Gaussian | 7.98 -> 4.28 MB | 39.90 -> 21.41 MB |
  | `/equation/fit` | 7.53 -> 3.71 MB | 37.64 -> 18.54 MB |
  | `/diagnostics` request | 7.79 MB -> 0.1 kB | 38.95 MB -> 0.1 kB |
  | `/diagnostics` response, panel / Q-Q plot | 7.63 MB -> 0.5 / 40 kB | 38.13 MB -> 0.5 / 40 kB |
