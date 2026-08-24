// Pure helpers for the Peak Analyzer wizard's marker placement (M3 review
// finding, round 3 of UX-R6's "Label peaks" review — same latent bug as
// usePeaks.ts's L1/L2, a third call site). No React/store import — used by
// components/workshops/peakwizard/usePeakWizard.ts.
//
// THE BUG: `findPeaks` there runs on `workingY`, the wizard's OWN
// baseline-subtracted trace (step ①'s live subtract preview) — so a
// candidate peak's `height + bg` (same "height above bg" convention as
// `Peak`/`FittedPeak`, lib/types.ts) is the apex WITHIN that corrected
// trace, not on the plot. The plot always shows the RAW data with the
// fitted baseline drawn as a separate reference line
// (`setBaselineOverlay`), never displaced by the subtraction — so a marker
// must be shifted back by the wizard's own baseline value at that x to
// land where the peak actually is on the visible curve.

/** Nearest-sample lookup into a baseline array aligned to `x` (the SAME
 *  grid the wizard's own baseline is defined over — `segment.x`, not the
 *  full dataset x). Returns `0` whenever there is no baseline (method
 *  "none", or not yet computed) or nothing finite nearby — `workingY`
 *  already equals the raw segment then, so no correction is needed. */
export function baselineValueAt(
  center: number,
  x: readonly number[],
  baseline: readonly (number | null)[] | null,
): number {
  if (!baseline || x.length === 0) return 0;
  let nearest = 0;
  let bestDist = Infinity;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - center);
    if (d < bestDist) {
      bestDist = d;
      nearest = i;
    }
  }
  const v = baseline[nearest];
  return v != null && Number.isFinite(v) ? v : 0;
}

/** A candidate peak's apex AS IT ACTUALLY SITS ON THE PLOT: `height + bg`
 *  (the apex within the baseline-subtracted `workingY`) plus the baseline
 *  value at that x (mapping back into the plot's own, undisplaced
 *  coordinates). Used for BOTH the marker-overlay draw and the click-hit-
 *  test bridge in `usePeakWizard.ts` — the two must always agree, or a
 *  click would land next to the marker it's supposed to hit rather than on
 *  it. A manually added peak (`addPeakAt`) passes `bg: 0` — its `height`
 *  already reads straight off `workingY`, with no detector background to
 *  separate out. */
export function plotApexY(height: number, bg: number, baselineAtCenter: number): number {
  return height + bg + baselineAtCenter;
}
