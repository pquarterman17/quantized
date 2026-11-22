// The Curve Fit's "initial guess" preview: ONE transient curve the Curve Fit
// panel asks the focused plot to draw while the user tunes starting values.
//
// It is deliberately NOT a `fitOverlay`. That slot is a fit RESULT: it is
// remembered by the Curve Fit session, exported with the figure, saved with the
// workspace and read by "Remove fit" / the bands. A preview must never be any of
// those, so it lives here, outside the app store (and so outside autosave,
// undo history and window capture), and is composed onto the drawn payload only
// (lib/fitPreviewCurve.ts, components/Stage/useStageOverlays.ts). The vector
// figure export builds from the store's overlays, so it never sees this; the
// canvas itself shows it, so a screenshot or PNG of the canvas does too.
//
// The slot holds the MODEL EXPRESSION and parameters, not a column: the curve
// is evaluated at the x the plot actually drew, so it lines up at any
// resolution (a server-decimated payload included) with no alignment rules.
//
// Tiny and eager (the Stage reads it); the heavy parts stay in the lazy panel.

import { useSyncExternalStore } from "react";

export interface FitPreviewCurve {
  /** The worksheet the start values are for; drawn only on that plot. */
  datasetId: string;
  /** The X channel the fit runs against (`null` = the time axis); drawn only
   *  when the plot's X is that channel, so the curve is never laid on another
   *  axis' x values. */
  xKey: number | null;
  /** The model over `x` and `p0..pn` in the worksheet formula language
   *  (lib/derivedFitModels.ts). */
  expr: string;
  params: readonly number[];
}

let current: FitPreviewCurve | null = null;
const listeners = new Set<() => void>();

export function setFitPreview(next: FitPreviewCurve | null): void {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

export const getFitPreview = (): FitPreviewCurve | null => current;

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The preview curve to draw, or null. */
export const useFitPreviewCurve = (): FitPreviewCurve | null => useSyncExternalStore(subscribe, getFitPreview, getFitPreview);
