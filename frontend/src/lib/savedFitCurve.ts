// A saved fit's curve, regenerated from its model + parameters over the rows
// it was FITTED on (the backend's model evaluation, no bands). Shared by the
// result plot gate (store/analysisResultPlotOpen), the Batch Figure Builder
// (store/batchFigureFits) and the reopen fallback (store/overlayRestore), so a
// fit is evaluated the same way everywhere -- and the way Curve Fit drew it.
//
// The rows (`fittedRows`) mirror useCurveFit's overlay: its explicit row
// selection (`FitSpec.rowIds`, while the sheet still has the row count it was
// recorded against), else the rows active in the analysis (excluded and
// filtered-out rows dropped), then only those inside the recorded fit window
// (`FitSpec.range`). Every other row is null -- the curve is never extrapolated
// over the rest of the sheet or drawn through excluded points.

import { fitBands } from "./api/fitStats";
import { fullPlottedX } from "./fitselectionActions";
import { droppedRows } from "./rowstate";
import type { Dataset, FitSpec } from "./types";

/** The row indices `spec` was fitted on (module header). */
export function fittedRows(ds: Dataset, spec: FitSpec, xKey: number | null): number[] {
  const n = ds.data.time.length;
  const dropped = droppedRows(ds);
  const selected = spec.rowIds && (spec.sourceRowCount === undefined || spec.sourceRowCount === n)
    ? spec.rowIds.filter((r) => Number.isInteger(r) && r >= 0 && r < n)
    : Array.from({ length: n }, (_, r) => r);
  const xs = fullPlottedX(ds.data, xKey);
  const [lo, hi] = spec.range ?? [-Infinity, Infinity];
  return selected.filter((r) => !dropped.has(r) && Number.isFinite(xs[r]) && xs[r] >= lo && xs[r] <= hi);
}

/** `spec`'s model evaluated at the rows it was fitted on (row-aligned to
 *  `ds.data`, null elsewhere), or an error message. */
export async function evaluateSavedFit(
  ds: Dataset,
  spec: FitSpec,
  params: number[],
  xKey: number | null,
): Promise<(number | null)[] | string> {
  const xs = fullPlottedX(ds.data, xKey);
  const rows = fittedRows(ds, spec, xKey);
  if (!rows.length) return "the saved fit's rows have no finite X values";
  try {
    const evaluated = await fitBands({
      model: spec.model,
      params,
      covar: null,
      x: rows.map((r) => xs[r]),
      // Only yFit is read (covar null -> no bands), so the counts are nominal.
      n_points: spec.nPoints ?? rows.length,
      n_free: spec.nFree ?? params.length,
    });
    if (!Array.isArray(evaluated.yFit) || evaluated.yFit.length !== rows.length ||
        !evaluated.yFit.every((value) => value === null || (typeof value === "number" && Number.isFinite(value)))) {
      return "model evaluation returned the wrong number of fitted values";
    }
    const y: (number | null)[] = Array.from({ length: xs.length }, () => null);
    rows.forEach((r, i) => { y[r] = evaluated.yFit[i] ?? null; });
    return y;
  } catch (error) {
    return error instanceof Error ? error.message : "model evaluation failed";
  }
}
