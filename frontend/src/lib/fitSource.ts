// Fit inputs by dataset handle (P4 phase 3, plans/LARGE_PAYLOAD_PLAN.md;
// backend routes/_datasetrows.py). Lazy: import it from lazy code only.
//
// A 1M-row Curve Fit posted x and y (38.6 MB of JSON) that it had sliced out
// of a dataset the server already holds (the import cached it; every plot
// fetch names it by handle). When the server holds `data` (a remembered or
// in-flight handle, lib/api/datasetCache), the request instead names the
// dataset, the X and Y channel (-1 = time) and the fitted rows as
// [start, count] runs, and the server gathers x/y itself.
//
// The selection rules stay HERE, on the client, exactly as before: the rows
// are the ones the fit already used (`fitRowsOf`: the analysis view, an
// analysis selection, the gap drop) and the X channel is the Y's own X
// (per-series X, `selectedFitData`). The server only gathers those rows and
// writes them as the array path's JSON would have (no NaN can be sent, -0
// becomes 0), so the fit is the same fit, bit for bit (the rows gather to the
// posted x/y: useCurveFit.bySource.test.ts, peakInputs.rows.test.ts; the
// gather fits identically: tests/test_api_fit_by_handle.py).
//
// No handle remembered: the arrays are posted as before (a first upload of
// every channel would cost more than x/y). A stale handle is a 409 and the
// dataset is resent once with the same request (`postJSONDatasetAware`),
// which earns a fresh handle for the next fit. If that resend is refused too
// (413: a dataset wider than the body cap, or another 409) the arrays are
// posted, so the worst case is the request as it always was.

import { hasDatasetHandle, postJSONDatasetAware } from "./api/datasetCache";
import { fitEquation, type EquationFitRequest } from "./api/curvefit";
import { fitSolverExtra } from "./fitSolverBody";
import { withResiduals } from "./fitResiduals";
import { fetchJSON, type HttpError } from "./api/http";
import type { CalcResult, DataStruct, FitWeighting } from "./types";

/** Where a fit's x/y came from: `data`'s column `xKey` (null = time) and
 *  column `yKey`, at the rows the fit reads. */
export interface FitSource {
  data: DataStruct;
  xKey: number | null;
  yKey: number;
}

/** Rows as ascending numbers, or as `[start, count]` runs already (a whole
 *  column is `{ runs: [[0, n]] }`, not an n-long array). */
export type Rows = readonly number[] | { runs: [number, number][] };

/** Strictly ascending rows as [start, count] runs; null otherwise. */
export function rowRuns(rows: readonly number[]): [number, number][] | null {
  const runs: [number, number][] = [];
  let prev = -1;
  for (const r of rows) {
    if (!Number.isInteger(r) || r <= prev) return null;
    const last = runs[runs.length - 1];
    if (last && last[0] + last[1] === r) last[1] += 1;
    else runs.push([r, 1]);
    prev = r;
  }
  return runs;
}

/** Which columns a route reads: both (the default), only Y (ALS, rolling
 *  ball, ModPoly) or only the one sample `xKey` names (descriptive stats). */
export type SourceOnly = "x" | "y";

/** Weights taken straight from a dataset column (`dyForFit`'s error-column
 *  and direct modes): `dy` = the column whose absolute value is sigma,
 *  `weights` = the column used as is. The server reads them at the same rows
 *  as x/y, so `dy` / `weights` leave the request. */
export interface WeightCols {
  dy?: number;
  weights?: number;
}

/** The weight column behind a resolved weighting, or undefined when the
 *  vector is derived (poisson: sqrt of y) and must ride as an array. Only
 *  meaningful once `dyForFit` produced a vector: it already refused a missing
 *  or invalid column. */
export function weightColsOf(weight: FitWeighting): WeightCols | undefined {
  if (weight.errKey == null) return undefined;
  if (weight.mode === "yerr" || weight.mode === "manual") return { dy: weight.errKey };
  return weight.mode === "direct" ? { weights: weight.errKey } : undefined;
}

/** The fields that replace x/y for `src` at `rows`, or null when the arrays
 *  must be posted (no handle for `src.data`, or rows not ascending). */
export function sourceFields(
  src: FitSource,
  rows: Rows,
  only?: SourceOnly,
): Record<string, unknown> | null {
  if (!hasDatasetHandle(src.data)) return null;
  const runs = "runs" in rows ? rows.runs : rowRuns(rows);
  if (!runs) return null;
  return {
    dataset: src.data,
    ...(only === "y" ? {} : { x_channel: src.xKey ?? -1 }),
    ...(only === "x" ? {} : { y_channel: src.yKey }),
    rows: runs,
  };
}

/** POST `body` to `path` with its x/y replaced by `src` at `rows` when the
 *  server holds the dataset, else run `arrays` (the request as it was).
 *  `opts.weights`: columns that replace `body.dy` / `body.weights` the same
 *  way (the arrays path keeps them); `opts.only`: a y-only or x-only route. */
export async function postBySource<T, B extends object = { x: readonly number[]; y: readonly number[] }>(
  path: string,
  body: B,
  src: FitSource | undefined,
  rows: Rows,
  arrays: () => Promise<T>,
  opts: { only?: SourceOnly; weights?: WeightCols } = {},
): Promise<T> {
  const fields = src ? sourceFields(src, rows, opts.only) : null;
  if (!fields) return arrays();
  const { x: _x, y: _y, dy, weights, ...rest } = body as B & Record<string, unknown>;
  const cols = opts.weights;
  const kept = {
    ...rest,
    ...(cols?.dy === undefined && dy !== undefined ? { dy } : {}),
    ...(cols?.weights === undefined && weights !== undefined ? { weights } : {}),
    ...(cols?.dy !== undefined ? { dy_channel: cols.dy } : {}),
    ...(cols?.weights !== undefined ? { weights_channel: cols.weights } : {}),
  };
  try {
    return await postJSONDatasetAware<T>(path, { ...kept, ...(await fitSolverExtra(path)), ...fields }, undefined, fetchJSON);
  } catch (err) {
    const status = (err as HttpError | null)?.status;
    if (status === 409 || status === 413) return arrays();
    throw err;
  }
}

/** A lean (`return_residuals: false`) custom-equation fit of `req.x`/`req.y`,
 *  sent by dataset handle + `rows` when the server holds `src` (P8; the
 *  display-curve opt-in stays off for equations: `positive_even_params` flips
 *  a sign after the fit, so `f(x, -p)` is not bit-identical). Residuals are
 *  restored from the posted y exactly as `leanFit` does. */
export async function leanEquationFit(
  req: EquationFitRequest,
  src: FitSource | undefined,
  rows: readonly number[],
  weights?: WeightCols,
): Promise<CalcResult> {
  const body = { ...req, return_residuals: false };
  const raw = await postBySource<CalcResult>(
    "/api/fitting/equation/fit", body, src, rows, () => fitEquation(body), { weights });
  return withResiduals(raw, req.y);
}
