// Curve Fit — "Remove fit", and its Undo.
//
// Removing a fit deletes what the confirmation names: the curve (and its
// band), the worksheet's FitSpec (so auto re-fit stops) and the fit's Library
// result. The FitSpec and the Library result are in the undo snapshot; the
// curve (`fitOverlay`) and the panel's in-memory result are not, so an Undo
// used to bring back only the recipe — the curve stayed gone and the panel
// stayed empty until the Library result was reopened. The session record
// (curveFitSession.ts) is therefore kept, flagged `removed`, and a store
// subscription puts the curve and the result back the moment the worksheet
// has its fit again (an Undo), and takes them away again on a Redo.

import { isFitResultForDataset } from "../../../lib/fitAnalysisResultLive";
import { isCurveFitOverlay, rememberCurveFitOverlay } from "../../../store/curveFitOverlay";
import { useApp } from "../../../store/useApp";
import { announceRetainedFit, restoreFitted, retainedFit } from "./curveFitSession";

let watching = false;

/** Follow undo/redo of a removal: installed once, on the first removal. */
function watch(): void {
  if (watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    const kept = retainedFit();
    if (!kept || s.datasets === prev.datasets) return;
    const present = restoreFitted(s.datasets) !== null;
    if (kept.removed && present) {
      // Undo of the removal: the worksheet has its fit again.
      kept.removed = false;
      if (kept.overlay && s.fitOverlay === null) {
        rememberCurveFitOverlay(kept.overlay);
        s.setFitOverlay(kept.overlay);
      }
      announceRetainedFit(true);
    } else if (!kept.removed && !present && s.datasets.some((d) => d.id === kept.fitted.datasetId && !d.fitSpec)) {
      // Redo of the removal (the history restore already cleared the curve).
      kept.removed = true;
      if (isCurveFitOverlay(prev.fitOverlay)) kept.overlay = prev.fitOverlay;
      rememberCurveFitOverlay(null);
      announceRetainedFit(false);
    }
  });
}

/** Delete the Curve Fit of `datasetId` (null = no worksheet: only the curve
 *  the Curve Fit itself drew). The caller records the undo step first. */
export function removeCurveFit(datasetId: string | null): void {
  const s = useApp.getState();
  const shown = s.fitOverlay;
  const cleared = isCurveFitOverlay(shown) || (datasetId !== null && shown?.datasetId === datasetId) ? shown : null;
  const kept = retainedFit();
  if (kept) {
    kept.removed = true;
    kept.overlay = cleared;
    watch();
  }
  if (cleared) s.setFitOverlay(null);
  rememberCurveFitOverlay(null);
  if (datasetId === null) return;
  s.setFitSpec(datasetId, null);
  useApp.setState((state) => {
    const gone = new Set(state.analysisResults.filter((r) => isFitResultForDataset(r, datasetId)).map((r) => r.id));
    return {
      staleFits: state.staleFits.filter((id) => id !== datasetId),
      ...(gone.size
        ? {
            analysisResults: state.analysisResults.filter((r) => !gone.has(r.id)),
            openAnalysisResultId: gone.has(state.openAnalysisResultId ?? "") ? null : state.openAnalysisResultId,
            librarySelection:
              state.librarySelection?.kind === "analysis-result" && gone.has(state.librarySelection.id) ? null : state.librarySelection,
          }
        : {}),
    };
  });
}
