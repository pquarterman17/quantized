// Curve Fit — what outlives the panel being CLOSED (it only hides now).
//
// Closing the Curve Fit window used to clear the fit: the curve vanished, the
// recalc graph lost its FitSpec (so auto re-fit stopped) and the Library
// result went "Incomplete". Closing is now a hide, so the in-memory result
// the panel shows (`useCurveFit`'s `fitted`) must survive the unmount; it is
// kept here, module-level, and restored on the next mount only while it still
// describes the live worksheet (same dataset object, FitSpec still present).
// (Which `fitOverlay` is the Curve Fit's own lives in store/curveFitOverlay.ts.)

import type { CalcResult, Dataset } from "../../../lib/types";

/** The (x, y) pairs a completed fit ran on (gap rows dropped), the channels
 *  they came from and the 1-sigma errors it was weighted with (null =
 *  unweighted), so a report reproduces the fit's own weighted sums. */
export interface FittedData {
  x: number[];
  y: number[];
  xKey: number | null;
  yKey: number;
  dy?: number[] | null;
}

export interface Fitted {
  result: CalcResult;
  fitData: FittedData | null;
  datasetId: string;
  model: string;
  xKey: number | null;
  yKey: number;
}

let retained: { fitted: Fitted; dataset: Dataset } | null = null;

/** Remember the latest fit (null forgets it, e.g. after "Remove fit"). */
export function retainFitted(fitted: Fitted | null, dataset: Dataset | null): void {
  retained = fitted && dataset ? { fitted, dataset } : null;
}

/** The retained fit, if the worksheet it ran on is unchanged and still has its fit. */
export function restoreFitted(datasets: readonly Dataset[]): Fitted | null {
  if (!retained) return null;
  const live = datasets.find((d) => d.id === retained!.fitted.datasetId);
  if (!live?.fitSpec || live.data !== retained.dataset.data) return null;
  return retained.fitted;
}

/** The Bands toggle's choices, kept across a close/reopen like the band they draw. */
export const bandPrefs = { on: false, level: 0.95, prediction: false };
