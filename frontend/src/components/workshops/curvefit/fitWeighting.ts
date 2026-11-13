// Curve Fit — the panel's weighting choice as a FitWeighting, and the
// weighting a fit WOULD use on the current rows. Shared by the fit itself
// (useCurveFit.run) and the stale-result check, so "the result describes
// earlier inputs" also covers an edited σ / weight column, a changed weight
// mode and the error-scaling switch (integration review item 3), not only
// edited x / y.

import { dropGapRows } from "../../../lib/api/finitePairs";
import { dyForFit } from "../../../lib/fitweights";
import type { Dataset, FitWeighting, WeightMode } from "../../../lib/types";
import type { WeightingNow } from "../../../store/curveFitSession";

/** The weighting choice for primary channel `yKey`: `yerr` resolves its sigma
 *  column from the view's `errKeys`; `manual` / `direct` use the picked column. */
export function weightingOf(
  mode: WeightMode, errKeys: Record<number, number>, manualKey: number | null, scaleErrors: boolean, yKey: number,
): FitWeighting {
  const scale = scaleErrors ? {} : { scaleErrors: false as const };
  if (mode === "yerr") return { mode: "yerr", errKey: errKeys[yKey], ...scale };
  if (mode === "manual" || mode === "direct")
    return manualKey != null ? { mode, errKey: manualKey, ...scale } : { mode, ...scale };
  return mode === "none" ? { mode: "none" } : { mode, ...scale };
}

/** The weighting vector a fit of `xy` (the analysis rows) would use now, over
 *  the same kept rows as the fit (gap rows dropped), with its mode and scale
 *  flag; mode "none" when it would run unweighted. */
export function weightingNow(
  ds: Dataset,
  xy: { x: readonly number[]; y: readonly number[]; yKey: number; analysisRows?: number[] },
  weight: FitWeighting,
): WeightingNow {
  const pairs = dropGapRows(xy.x, xy.y);
  const keep = pairs.keep.map((index) => xy.analysisRows?.[index] ?? index);
  const { dy } = dyForFit(ds, xy.yKey, weight, keep);
  if (!dy) return { mode: "none", values: null, scaleErrors: true };
  return { mode: weight.mode, values: keep.map((index) => dy[index]!), scaleErrors: weight.scaleErrors !== false };
}
