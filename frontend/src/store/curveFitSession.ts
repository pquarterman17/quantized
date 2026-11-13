// Curve Fit — what outlives the panel being CLOSED (it only hides now).
//
// Closing the Curve Fit window used to clear the fit: the curve vanished, the
// recalc graph lost its FitSpec (so auto re-fit stopped) and the Library
// result went "Incomplete". Closing is now a hide, so the in-memory result
// the panel shows (`useCurveFit`'s `fitted`) must survive the unmount; it is
// kept here, module-level, and restored on the next mount only while the
// worksheet's saved fit is still that fit (see `restoreFitted`).
// (Which `fitOverlay` is the Curve Fit's own lives in store/curveFitOverlay.ts.)

import type { CalcResult, Dataset, FitOverlay } from "../lib/types";

/** The (x, y) pairs a completed fit ran on (gap rows dropped), the channels
 *  they came from and how it was weighted, so a report reproduces the fit's
 *  own weighted sums: `dy` = the 1-sigma errors of an error-column/Poisson
 *  fit, `weights` = the weights themselves of a direct-weighted fit (Origin's
 *  "Direct weighting"; zero allowed). At most one is set; neither = unweighted. */
export interface FittedData {
  x: number[];
  y: number[];
  xKey: number | null;
  yKey: number;
  dy?: number[] | null;
  weights?: number[] | null;
}

/** `dy` vs `weights` for FittedData from the column a fit was weighted with:
 *  a direct-weighted fit's column holds weights, never 1-sigma errors. */
export function fittedWeighting(mode: string | undefined, values: number[] | null): Pick<FittedData, "dy" | "weights"> {
  if (!values) return { dy: null };
  return mode === "direct" ? { dy: null, weights: values } : { dy: values };
}

/** Is this fit weighted (either way)? */
export const fitIsWeighted = (d: FittedData): boolean => d.dy != null || d.weights != null;

export interface Fitted {
  result: CalcResult;
  fitData: FittedData | null;
  datasetId: string;
  model: string;
  xKey: number | null;
  yKey: number;
}

/** One worksheet's retained fit. `removed`: "Remove fit" deleted it — the
 *  record is KEPT so an Undo of the removal can put the curve and the panel's
 *  result back (curveFitRemove.ts). `overlay` is the curve the fit drew (with
 *  its band, when a removal took one off the plot), so it can be drawn again
 *  when the panel comes back to this worksheet. */
export interface RetainedFit {
  fitted: Fitted;
  dataset: Dataset;
  removed: boolean;
  overlay: FitOverlay | null;
}

// Keyed by worksheet: fitting a second worksheet must not forget the first
// one's result (going back to it used to show an empty panel beside a
// worksheet that still had its saved fit and Library result).
const records = new Map<string, RetainedFit>();

/** Remember `fitted` as its worksheet's fit, with the curve it drew.
 *  `retainFitted(null, null)` forgets everything (a fresh session). */
export function retainFitted(fitted: Fitted | null, dataset: Dataset | null, overlay: FitOverlay | null = null): void {
  if (!fitted || !dataset) {
    records.clear();
    return;
  }
  records.set(fitted.datasetId, { fitted, dataset, removed: false, overlay });
}

/** The fit retained for worksheet `datasetId`, while the worksheet's saved
 *  fit is still THIS fit (the same FitSpec object: not removed, re-fitted or
 *  replaced by another tool). Deliberately not "the same data object": adding
 *  a column — the fit's own linked output columns included — replaces the data
 *  object without touching the fit, and used to make a reopened panel come
 *  back empty beside its curve. Data the fit would no longer reproduce is
 *  `fitInputsChanged`'s job. */
export function restoreFitted(datasets: readonly Dataset[], datasetId: string | null): Fitted | null {
  const kept = datasetId === null ? undefined : records.get(datasetId);
  if (!kept) return null;
  const live = datasets.find((d) => d.id === datasetId);
  if (!live?.fitSpec || live.fitSpec !== kept.dataset.fitSpec) return null;
  return kept.fitted;
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

/** A worksheet's record itself, for the removal / undo / re-fit bookkeeping. */
export const retainedFit = (datasetId: string): RetainedFit | null => records.get(datasetId) ?? null;

/** Every record (the undo watcher walks them). */
export const retainedFits = (): RetainedFit[] => [...records.values()];

type RetainedListener = (fitted: Fitted, present: boolean, replaces?: Fitted) => void;
const listeners = new Set<RetainedListener>();

/** Told when a retained fit changes behind the panel's back, so an open
 *  panel follows without a remount: an Undo brings a removed fit back
 *  (`present`), a Redo removes it again (`!present`), or a background re-fit
 *  replaced its result (`replaces` = the record it supersedes). */
export function onRetainedFitChange(fn: RetainedListener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function announceRetainedFit(kept: RetainedFit, present: boolean, replaces?: Fitted): void {
  for (const fn of listeners) fn(kept.fitted, present, replaces);
}

/** Replace a retained fit's result with a background re-fit's (curveFitRefit.ts). */
export function replaceRetainedFit(fitted: Fitted, dataset: Dataset, overlay: FitOverlay | null): void {
  const kept = records.get(fitted.datasetId);
  if (!kept) return;
  const next = { ...kept, fitted, dataset, overlay };
  records.set(fitted.datasetId, next);
  announceRetainedFit(next, true, kept.fitted);
}

/** The Bands toggle's choices, kept across a close/reopen like the band they draw. */
export const bandPrefs = { on: false, level: 0.95, prediction: false };

/** The Fit report's confidence level, kept across a close/reopen and shared
 *  with "→ Report", so the report sheet's limits are at the level the panel shows. */
export const reportPrefs = { level: 0.95 };
