// A saved fit's curve, regenerated from its model + parameters at every finite
// row of the X it was fitted on (the backend's model evaluation, no bands).
// Moved out of store/analysisResultPlotOpen.ts so the result plot gate and the
// Batch Figure Builder (store/batchFigureFits.ts) evaluate a fit the SAME way.

import { fitBands } from "./api/fitStats";
import { fullPlottedX } from "./fitselectionActions";
import type { Dataset, FitSpec } from "./types";

/** `spec`'s model evaluated at every finite row of X `xKey` (row-aligned to
 *  `ds.data`, null elsewhere), or an error message. */
export async function evaluateSavedFit(
  ds: Pick<Dataset, "data">,
  spec: FitSpec,
  params: number[],
  xKey: number | null,
): Promise<(number | null)[] | string> {
  const xs = fullPlottedX(ds.data, xKey);
  const finite = xs.flatMap((value, index) => Number.isFinite(value) ? [{ value, index }] : []);
  if (!finite.length) return "the saved X channel has no finite values";
  try {
    const evaluated = await fitBands({
      model: spec.model,
      params,
      covar: null,
      x: finite.map((entry) => entry.value),
      // Only yFit is read (covar null -> no bands), so the counts are nominal.
      n_points: spec.nPoints ?? finite.length,
      n_free: spec.nFree ?? params.length,
    });
    if (!Array.isArray(evaluated.yFit) || evaluated.yFit.length !== finite.length ||
        !evaluated.yFit.every((value) => value === null || (typeof value === "number" && Number.isFinite(value)))) {
      return "model evaluation returned the wrong number of fitted values";
    }
    const y: (number | null)[] = Array.from({ length: xs.length }, () => null);
    finite.forEach((entry, index) => { y[entry.index] = evaluated.yFit[index] ?? null; });
    return y;
  } catch (error) {
    return error instanceof Error ? error.message : "model evaluation failed";
  }
}
