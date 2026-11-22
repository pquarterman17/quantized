// The focused Stage's four analysis-overlay reads (fit, peak, baseline,
// derivative), moved out of PlotStage.tsx (its component ceiling) as one
// cohesive group when the colour gradient added a line there (gap audit 4),
// plus the Curve Fit's initial-guess preview, folded onto the drawn payload.

import { useMemo } from "react";

import { previewShifted, withFitPreview } from "../../lib/fitPreviewCurve";
import { useFitPreviewCurve } from "../../lib/fitPreviewSlot";
import type { PlotPayload } from "../../lib/plotdata";
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

/** `payload` plus the Curve Fit's initial-guess preview (lib/fitPreviewSlot.ts)
 *  when one is up for this dataset and X channel (and no waterfall / decade offset
 *  shifts the drawn data). Display only: it is not in the store, so no save,
 *  undo or vector export sees it. */
export function useFitPreviewPayload(payload: PlotPayload | null, datasetId: string | null): PlotPayload | null {
  const curve = useFitPreviewCurve();
  const xKey = useApp((s) => s.xKey);
  const shifted = useApp((s) => previewShifted(s.waterfall, s.seriesStyles));
  return useMemo(() => withFitPreview(payload, curve, { datasetId, xKey, shifted }), [payload, curve, datasetId, xKey, shifted]);
}
