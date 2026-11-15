// A saved fit's curve, regenerated from its model + parameters over the rows
// it was FITTED on (the backend's model evaluation, no bands). Shared by the
// result plot gate (store/analysisResultPlotOpen), the Batch Figure Builder
// (store/batchFigureFits) and the reopen fallback (store/overlayRestore), so a
// fit is evaluated the same way everywhere -- and the way Curve Fit drew it.
//
// The rows (`fittedRows`) are the fit's own replay selection
// (lib/fitselection.fitDataForSpec): its explicit row selection, its fit
// window and the active analysis rows, then only the rows whose X AND Y are
// finite -- exactly the points Curve Fit's overlay covered (`dropGapRows`), so
// the curve breaks at a blank Y as on screen. A recorded row selection that no
// longer identifies its rows (inserted, deleted or reordered rows) is REFUSED
// with a reason, never widened to the whole sheet.

import { fitBands } from "./api/fitStats";
import { dropGapRows } from "./api/finitePairs";
import { fitDataForSpec } from "./fitselection";
import { activeRowIndices, droppedRows } from "./rowstate";
import type { Dataset, FitSpec } from "./types";

/** The worksheet rows `spec` was fitted on and their X, or why they cannot be
 *  identified any more. */
export function fittedRows(ds: Dataset, spec: FitSpec, yKey = spec.yKey): { rows: number[]; x: number[] } | string {
  const sel = yKey === undefined ? null : fitDataForSpec(ds, { ...spec, yKey }, spec.xKey ?? null, [yKey], null);
  if (!sel) return "the fit's row selection no longer matches the sheet (rows inserted, deleted or reordered); re-fit to redraw it";
  const rows = sel.sourceRows ?? activeRowIndices(ds.data.time.length, droppedRows(ds));
  if (rows.length !== sel.x.length) return "the fit's rows could not be matched to the sheet; re-fit to redraw it";
  const keep = dropGapRows(sel.x, sel.y).keep;
  return { rows: keep.map((i) => rows[i]), x: keep.map((i) => sel.x[i]) };
}

/** `spec`'s model evaluated at the rows it was fitted on (row-aligned to
 *  `ds.data`, null elsewhere), or an error message. `yKey` is the fitted Y
 *  the caller resolved (a legacy spec may not record it). */
export async function evaluateSavedFit(
  ds: Dataset, spec: FitSpec, params: number[], yKey = spec.yKey,
): Promise<(number | null)[] | string> {
  const fitted = fittedRows(ds, spec, yKey);
  if (typeof fitted === "string") return fitted;
  if (!fitted.rows.length) return "the saved fit's rows have no finite values";
  try {
    const evaluated = await fitBands({
      model: spec.model,
      params,
      covar: null,
      x: fitted.x,
      // Only yFit is read (covar null -> no bands), so the counts are nominal.
      n_points: spec.nPoints ?? fitted.rows.length,
      n_free: spec.nFree ?? params.length,
    });
    if (!Array.isArray(evaluated.yFit) || evaluated.yFit.length !== fitted.rows.length ||
        !evaluated.yFit.every((value) => value === null || (typeof value === "number" && Number.isFinite(value)))) {
      return "model evaluation returned the wrong number of fitted values";
    }
    const y: (number | null)[] = Array.from({ length: ds.data.time.length }, () => null);
    fitted.rows.forEach((r, i) => { y[r] = evaluated.yFit[i] ?? null; });
    return y;
  } catch (error) {
    return error instanceof Error ? error.message : "model evaluation failed";
  }
}
