// The Curve Fit's claim on the shared `fitOverlay` slot, and its band on it.
//
// Several tools draw into the one `fitOverlay` slot (Curve Fit, Quick Fit,
// the peak and reflectivity fits). The Curve Fit remembers which overlay
// object it drew, so its Bands toggle shades ONLY its own curve — never one
// another tool has since put in the slot — and so "Remove fit" knows the curve
// is its own. The band rides on the overlay (`FitOverlay.band`), so anything
// that clears or replaces the curve clears the band with it.

import type { FitOverlay } from "../lib/types";
import { useApp } from "./useApp";

let own: FitOverlay | null = null;

export function rememberCurveFitOverlay(o: FitOverlay | null): void {
  own = o;
}

/** True when `o` is the overlay the Curve Fit last drew. */
export function isCurveFitOverlay(o: FitOverlay | null): boolean {
  return o != null && o === own;
}

/** The Curve Fit's overlay for `datasetId` when it is the one showing. */
export function ownCurveFitOverlay(datasetId: string): FitOverlay | null {
  const o = useApp.getState().fitOverlay;
  return isCurveFitOverlay(o) && o!.datasetId === datasetId ? o : null;
}

/** Swap the Curve Fit overlay `from` for the same curve with `band`
 *  (undefined removes it) — a no-op when `from` was replaced meanwhile. */
export function setCurveFitOverlayBand(from: FitOverlay, band: FitOverlay["band"]): void {
  if (useApp.getState().fitOverlay !== from) return;
  const next: FitOverlay = { datasetId: from.datasetId, y: from.y, ...(band ? { band } : {}) };
  own = next;
  useApp.getState().setFitOverlay(next);
}
