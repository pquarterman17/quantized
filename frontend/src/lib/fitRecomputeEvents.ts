// A background re-fit of a worksheet's saved fit — the recalc graph after a
// data edit (store/recalcFits.ts) or the Library result's "Recalculate"
// (store/analysisResultActions.ts) — announced to whoever is showing that
// fit's numbers. The Curve Fit panel listens (curvefit/curveFitRefit.ts): it
// used to keep the ORIGINAL fit's parameters, report, residual plots and
// worksheet output on screen, unmarked, beside a curve that had already been
// re-fitted to the changed data.

import type { CalcResult, FitSpec } from "./types";

export interface FitRecomputed {
  datasetId: string;
  /** The FitSpec object the re-fit replaced (identity names WHICH fit it was). */
  previousSpec: FitSpec;
  /** The fitter's full response for the re-fit. */
  result: CalcResult;
  /** The pairs it ran on (gap rows dropped) and their 1-sigma errors (null = unweighted). */
  x: number[];
  y: number[];
  dy: number[] | null;
}

type Listener = (e: FitRecomputed) => void;
const listeners = new Set<Listener>();

export function onFitRecomputed(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function announceFitRecomputed(e: FitRecomputed): void {
  for (const fn of listeners) fn(e);
}
