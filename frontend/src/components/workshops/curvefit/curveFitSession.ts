// Curve Fit — what outlives the panel being CLOSED (it only hides now).
//
// Closing the Curve Fit window used to clear the fit: the curve vanished, the
// recalc graph lost its FitSpec (so auto re-fit stopped) and the Library
// result went "Incomplete". Closing is now a hide, so the in-memory result
// the panel shows (`useCurveFit`'s `fitted`) must survive the unmount; it is
// kept here, module-level, and restored on the next mount only while the
// worksheet's saved fit is still that fit (see `restoreFitted`).
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

/** The retained fit, while the worksheet's saved fit is still THIS fit (the
 *  same FitSpec object: not removed, re-fitted or replaced by another tool).
 *  Deliberately not "the same data object": adding a column — the fit's own
 *  linked output columns included — replaces the data object without touching
 *  the fit, and used to make a reopened panel come back empty beside its
 *  curve. Data the fit would no longer reproduce is `fitInputsChanged`'s job. */
export function restoreFitted(datasets: readonly Dataset[]): Fitted | null {
  if (!retained) return null;
  const live = datasets.find((d) => d.id === retained!.fitted.datasetId);
  if (!live?.fitSpec || live.fitSpec !== retained.dataset.fitSpec) return null;
  return retained.fitted;
}

/** True when the (x, y) pairs a fit would run on NOW (gap rows dropped) are
 *  not the pairs `fitData` ran on — an edited value, a newly excluded row or
 *  a changed X range — so the result describes earlier data. */
export function fitInputsChanged(now: { x: readonly number[]; y: readonly number[] }, fitData: FittedData): boolean {
  let k = 0;
  for (let i = 0; i < Math.min(now.x.length, now.y.length); i++) {
    const x = now.x[i]!;
    const y = now.y[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x !== fitData.x[k] || y !== fitData.y[k]) return true;
    k++;
  }
  return k !== fitData.x.length;
}

/** The retained record itself, for the removal/undo bookkeeping. */
export const retainedFit = (): typeof retained => retained;

type RetainedListener = (fitted: Fitted, present: boolean, replaces?: Fitted) => void;
const listeners = new Set<RetainedListener>();

/** Told when the retained fit changes behind the panel's back, so an open
 *  panel follows without a remount: an Undo brings a removed fit back
 *  (`present`), a Redo removes it again (`!present`), or a background re-fit
 *  replaced its result (`replaces` = the record it supersedes). */
export function onRetainedFitChange(fn: RetainedListener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function announceRetainedFit(present: boolean, replaces?: Fitted): void {
  if (retained) for (const fn of listeners) fn(retained.fitted, present, replaces);
}

/** Replace the retained fit's result with a background re-fit's (curveFitRefit.ts). */
export function replaceRetainedFit(fitted: Fitted, dataset: Dataset): void {
  if (!retained) return;
  const previous = retained.fitted;
  retained = { ...retained, fitted, dataset };
  announceRetainedFit(true, previous);
}

/** The Bands toggle's choices, kept across a close/reopen like the band they draw. */
export const bandPrefs = { on: false, level: 0.95, prediction: false };

/** The Fit report's confidence level, kept across a close/reopen and shared
 *  with "→ Report", so the report sheet's limits are at the level the panel shows. */
export const reportPrefs = { level: 0.95 };
