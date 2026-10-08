// Pure helpers for correcting an automatic peak list.  Auto-detection is a
// starting point, not ground truth: a user must be able to remove a background
// ripple and add a visually obvious missed peak without re-tuning the whole
// detector.

import { seedPeakNear } from "../../../lib/peakSeed";
import type { Peak } from "../../../lib/types";

export interface PeakDetectionData {
  x: number[];
  y: number[];
  fullX: number[];
  background: (number | null)[];
}

const nearestIndex = (xs: readonly number[], at: number): number => {
  let nearest = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - at) < Math.abs(xs[nearest] - at)) nearest = i;
  }
  return nearest;
};

const finiteBackground = (background: readonly (number | null)[], index: number): number => {
  const value = background[index];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

/** Build a manual candidate near ``at``, snapped to the local apex. */
export function manualPeakAt(data: PeakDetectionData, at: number): Peak | null {
  if (data.x.length === 0) return null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const x of data.x) {
    if (Number.isFinite(x)) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  if (!Number.isFinite(at) || at < lo || at > hi) return null;
  // The automatic detector finds peaks in y - background, so manual additions
  // must use the same coordinate system. Snapping against raw intensity makes
  // a steep low-angle XRD background win over the local diffraction apex: the
  // seeder then keeps the literal click (a slope/edge) instead of the peak.
  const corrected = data.y.map((value, index) => value - finiteBackground(data.background, index));
  const seed = seedPeakNear(data.x, corrected, at);
  if (!seed) return null;
  const i = nearestIndex(data.x, seed.center);
  const bg = finiteBackground(data.background, i);
  const height = Math.max(Number.EPSILON, seed.height);
  return {
    center: seed.center,
    height,
    fwhm: seed.fwhm,
    prominence: height,
    localSNR: Number.NaN,
    area: null,
    bg,
    status: "manual",
  };
}

export function withoutDetectedPeaks(peaks: readonly Peak[], indices: ReadonlySet<number>): Peak[] {
  return peaks.filter((_, index) => !indices.has(index));
}
