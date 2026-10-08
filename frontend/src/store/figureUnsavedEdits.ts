// The two "unsaved edits?" predicates behind the editable-figure close
// confirm and the Publication Preview discard confirm. Moved verbatim out of
// store/figureLifecycle.ts in bundle diet slice 24: only the lazy window
// chrome (components/windows/figureLifecycleUi.ts) calls them, so they ship
// with it instead of in the eager bundle. Import them by this path;
// figureLifecycle.ts does not re-export them (architecture.test.ts,
// DRAGGED_OUT).
import type { PlotWindow } from "../lib/plotview";
import type { FigurePublicationSession } from "./figureLifecycle";
import { liveWindowDocument } from "./liveWindowDocument";
import type { AppState } from "./useApp";

/** True only when a SAVED editable figure has drifted from the window's live
 *  state. Distinct from `editableFigureDirty` (which is also true for a
 *  window never saved as a figure — the titlebar ● indicator's meaning):
 *  destructive-action confirms are reserved for the opted-in saved-figure
 *  case. Closing a never-saved window is fully undoable (closeWindow records
 *  history and plotWindows is in the history snapshot) and the window
 *  persists in the workspace regardless, so per the confirm-exemption
 *  convention (GUI_INTERACTION #17: undoable actions don't confirm) it must
 *  not gate a routine MDI close. */
export function editableFigureHasUnsavedEdits(state: AppState, window: PlotWindow): boolean {
  if (window.kind !== "plot" || !window.document) return false;
  const saved = state.editableFigures.find((document) => document.id === window.document?.id);
  if (!saved) return false;
  const current = liveWindowDocument(state, window);
  return current !== null && JSON.stringify(saved) !== JSON.stringify(current);
}

export function figurePublicationDirty(session: FigurePublicationSession | null): boolean {
  return session !== null && JSON.stringify(session.baseline) !== JSON.stringify(session.draft);
}
