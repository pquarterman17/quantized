// The focused Stage's four analysis-overlay reads (fit, peak, baseline,
// derivative), moved out of PlotStage.tsx (its component ceiling) as one
// cohesive group when the colour gradient added a line there (gap audit 4).

import { useApp } from "../../store/useApp";

/** The overlays `usePlotPayload` splices onto the focused plot: fit, peak,
 *  baseline, derivative (a tuple, so the eager bundle carries no key names). */
export function useStageOverlays() {
  return [
    useApp((s) => s.fitOverlay),
    useApp((s) => s.peakOverlay),
    useApp((s) => s.baselineOverlay),
    useApp((s) => s.derivOverlay),
  ] as const;
}
