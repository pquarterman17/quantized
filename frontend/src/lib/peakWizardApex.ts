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

/** Index of the sample in an ASCENDING `x` nearest to `target`, via binary
 *  search (P5 review finding, round 6): `baselineValueAt` used to full-scan
 *  `x` per call, and it now runs from two `usePeakWizard.ts` effects that
 *  re-run on every `candidates` change — an include-toggle on a 1M-row
 *  dataset used to cost tens of millions of main-thread iterations for a
 *  single click. `x` here is always `segment.x`, a range-cut, order-
 *  preserving slice of the plotted x column (`cutRange` in peakwizard.ts
 *  filters, it never reorders) — so ascending is guaranteed, same
 *  precondition the wizard's own `span = x[last] - x[0]` already relies on
 *  (usePeakWizard.ts). On an exact distance tie between the two candidates
 *  straddling `target`, returns the SMALLER index (the earlier one),
 *  matching the previous linear scan's strict `d < bestDist` tie-break
 *  (first minimum wins, ties never overwrite it). */
function nearestIndexAscending(x: readonly number[], target: number): number {
  let lo = 0;
  let hi = x.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  // lo is now the first index with x[lo] >= target (or x.length - 1 if
  // target exceeds every sample) — compare it against its left neighbour,
  // the only other candidate that can possibly be nearest in sorted order.
  if (lo > 0) {
    const dLeft = Math.abs(x[lo - 1] - target);
    const dRight = Math.abs(x[lo] - target);
    if (dLeft <= dRight) return lo - 1;
  }
  return lo;
}

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
  const nearest = nearestIndexAscending(x, center);
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
