// Curve Fit — "Remove fit", and its Undo.
//
// Removing a fit deletes what the confirmation names: the curve (and its
// band), the worksheet's FitSpec (so auto re-fit stops) and the fit's Library
// result. The FitSpec and the Library result are in the undo snapshot; the
// curve (`fitOverlay`) and the panel's in-memory result are not, so an Undo
// used to bring back only the recipe — the curve stayed gone and the panel
// stayed empty until the Library result was reopened. The session record
// (store/curveFitSession.ts) is therefore kept, flagged `removed`, and a store
// subscription puts the curve and the result back the moment the worksheet
// has its fit again (an Undo), and takes them away again on a Redo.
// `showRetainedCurve` is the same put-back for a plain dataset switch.

import { isFitResultForDataset } from "../lib/fitAnalysisResultLive";
import { isCurveFitOverlay, rememberCurveFitOverlay } from "./curveFitOverlay";
import { useApp } from "./useApp";
import { announceRetainedFit, restoreFitted, retainedFit, retainedFits } from "./curveFitSession";

let watching = false;

/** Follow undo/redo of a removal: installed once, on the first removal. */
function watch(): void {
  if (watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    if (s.datasets === prev.datasets) return;
    for (const kept of retainedFits()) {
      const id = kept.fitted.datasetId;
      const present = restoreFitted(s.datasets, id) !== null;
      if (kept.removed && present) {
        // Undo of the removal: the worksheet has its fit again.
        kept.removed = false;
        if (kept.overlay && useApp.getState().fitOverlay === null) {
          rememberCurveFitOverlay(kept.overlay);
          s.setFitOverlay(kept.overlay);
        }
        announceRetainedFit(kept, true);
      } else if (!kept.removed && !present && s.datasets.some((d) => d.id === id && !d.fitSpec)) {
        // Redo of the removal (the history restore already cleared the curve).
        kept.removed = true;
        if (isCurveFitOverlay(prev.fitOverlay) && prev.fitOverlay?.datasetId === id) kept.overlay = prev.fitOverlay;
        announceRetainedFit(kept, false);
      }
    }
  });
}

/** Delete the Curve Fit of `datasetId` (null = no worksheet: only the curve
 *  the Curve Fit itself drew). The caller records the undo step first. */
export function removeCurveFit(datasetId: string | null): void {
  const s = useApp.getState();
  const shown = s.fitOverlay;
  const cleared = isCurveFitOverlay(shown) || (datasetId !== null && shown?.datasetId === datasetId) ? shown : null;
  const kept = datasetId === null ? null : retainedFit(datasetId);
  if (kept) {
    kept.removed = true;
    if (cleared) kept.overlay = cleared;
    watch();
  }
  if (cleared) s.setFitOverlay(null);
  if (cleared) rememberCurveFitOverlay(null);
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

/** Draw worksheet `datasetId`'s retained curve again when the plot is on that
 *  worksheet and shows no fit curve for it — the panel came back to a
 *  worksheet whose curve a dataset switch had cleared. A no-op unless the
 *  saved fit is still that fit and the curve still spans the worksheet's rows. */
export function showRetainedCurve(datasetId: string): void {
  const s = useApp.getState();
  const kept = retainedFit(datasetId);
  if (!kept?.overlay || kept.removed || s.activeId !== datasetId || s.fitOverlay?.datasetId === datasetId) return;
  const live = s.datasets.find((d) => d.id === datasetId);
  if (restoreFitted(s.datasets, datasetId) === null || live?.data.time.length !== kept.overlay.y.length) return;
  rememberCurveFitOverlay(kept.overlay);
  s.setFitOverlay(kept.overlay);
}
