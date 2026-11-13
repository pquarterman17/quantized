// Curve Fit — follow a background re-fit of the fit the panel is showing.
//
// After a data edit the recalc graph re-fits the worksheet's saved fit and
// redraws its curve; the Library result's "Recalculate" does the same on
// request. The panel's own result (parameters, statistics, fit report,
// residual plots, bands, worksheet output) used to stay the ORIGINAL fit's,
// unmarked — numbers for data that no longer exist beside a curve that had
// moved. The re-fit is announced with its full result (lib/fitRecomputeEvents)
// and adopted here as the session's fit, so the panel — open now or reopened
// later — shows what the curve shows. Only the fit the session itself ran is
// adopted (matched by the FitSpec object the re-fit replaced): another tool's
// fit on the same worksheet is not this panel's result.

import { onFitRecomputed } from "../../../lib/fitRecomputeEvents";
import { rememberCurveFitOverlay } from "../../../store/curveFitOverlay";
import { useApp } from "../../../store/useApp";
import { replaceRetainedFit, retainedFit } from "./curveFitSession";

let following = false;

/** Install the listener (once; called when the panel first mounts). */
export function followRefits(): void {
  if (following) return;
  following = true;
  onFitRecomputed((e) => {
    const kept = retainedFit();
    if (!kept || kept.removed || kept.fitted.datasetId !== e.datasetId || kept.dataset.fitSpec !== e.previousSpec) return;
    const s = useApp.getState();
    const live = s.datasets.find((d) => d.id === e.datasetId);
    if (!live?.fitSpec) return;
    const f = kept.fitted;
    // The re-fit redrew the curve as a new overlay object: it is still this fit's.
    if (s.fitOverlay?.datasetId === e.datasetId) rememberCurveFitOverlay(s.fitOverlay);
    replaceRetainedFit(
      { ...f, result: e.result, fitData: { x: e.x, y: e.y, xKey: f.xKey, yKey: f.yKey, dy: e.dy } },
      live,
    );
  });
}
