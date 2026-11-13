// Curve Fit — what outlives the panel being CLOSED (it only hides now).
//
// Closing the Curve Fit window used to clear the fit: the curve vanished, the
// recalc graph lost its FitSpec (so auto re-fit stopped) and the Library
// result went "Incomplete". Closing is now a hide, so the in-memory result
// the panel shows (`useCurveFit`'s `fitted`) must survive the unmount; it is
// kept here, module-level, and restored on the next mount only while it still
// describes the live worksheet (same dataset object, FitSpec still present).
// (Which `fitOverlay` is the Curve Fit's own lives in store/curveFitOverlay.ts.)

import type { CalcResult, Dataset, FitOverlay } from "../../../lib/types";

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

/** `removed`: "Remove fit" deleted it. The record is KEPT so an Undo of the
 *  removal can put the curve and the panel's result back (curveFitRemove.ts);
 *  `overlay` is the curve (with its band) the removal took off the plot. */
let retained: { fitted: Fitted; dataset: Dataset; removed: boolean; overlay: FitOverlay | null } | null = null;

/** Remember the latest fit (null forgets it). */
export function retainFitted(fitted: Fitted | null, dataset: Dataset | null): void {
  retained = fitted && dataset ? { fitted, dataset, removed: false, overlay: null } : null;
}

/** The retained fit, if the worksheet it ran on is unchanged and still has its fit. */
export function restoreFitted(datasets: readonly Dataset[]): Fitted | null {
  if (!retained) return null;
  const live = datasets.find((d) => d.id === retained!.fitted.datasetId);
  if (!live?.fitSpec || live.data !== retained.dataset.data) return null;
  return retained.fitted;
}

/** The retained record itself, for the removal/undo bookkeeping. */
export const retainedFit = (): typeof retained => retained;

type RetainedListener = (fitted: Fitted, present: boolean) => void;
const listeners = new Set<RetainedListener>();

/** Told when an Undo brings the removed fit back (`present`) or a Redo removes
 *  it again, so an open panel follows without a remount. */
export function onRetainedFitChange(fn: RetainedListener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function announceRetainedFit(present: boolean): void {
  if (retained) for (const fn of listeners) fn(retained.fitted, present);
}

/** The Bands toggle's choices, kept across a close/reopen like the band they draw. */
export const bandPrefs = { on: false, level: 0.95, prediction: false };
