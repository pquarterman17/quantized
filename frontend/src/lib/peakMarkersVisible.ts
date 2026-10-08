// The peak workshops' clickable-marker projection, moved verbatim out of
// lib/peakMarkerHit.ts in bundle diet slice 24: only the lazy peak workshops
// call it, so it ships with them instead of in the eager bundle. Import it by
// this path; peakMarkerHit.ts does not re-export it (architecture.test.ts,
// DRAGGED_OUT).
import type { PeakMarkerCandidate } from "./peakMarkerHit";

/** The markers actually drawn on the plot: only `included` candidates ride the
 *  `setPeakOverlay` series (see usePeakWizard's marker-overlay effect /
 *  `withPeakOverlay` in plotdata.ts), so only those are clickable for removal.
 *  Pure — no uPlot needed, trivially unit-tested without a plot instance. */
export function visiblePeakMarkers(
  candidates: readonly { center: number; height: number; included: boolean }[],
): PeakMarkerCandidate[] {
  const out: PeakMarkerCandidate[] = [];
  candidates.forEach((c, index) => {
    if (c.included) out.push({ index, center: c.center, height: c.height });
  });
  return out;
}
