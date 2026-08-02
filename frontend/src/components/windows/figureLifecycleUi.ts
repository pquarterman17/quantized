import { editableFigureHasUnsavedEdits, figurePublicationDirty } from "../../store/figureLifecycle";
import { useApp } from "../../store/useApp";
import { askConfirm } from "../overlays/ConfirmDialog";

/** The Publication Preview discard gate (three close paths: the Cancel
 *  button, the ToolWindow ×, and — once wired — any future close affordance)
 *  — the same convention `closeFigureWindow` applies to a saved editable
 *  figure: a dirty, non-undoable edit doesn't vanish without confirmation. A
 *  Publication Preview draft is never history-tracked (it only becomes real
 *  on Apply), so unlike closing a window, there is no Undo to fall back on. */
export async function cancelPublicationPreview(): Promise<void> {
  const state = useApp.getState();
  if (
    figurePublicationDirty(state.figurePublicationSession) &&
    !(await askConfirm(
      "Discard unpublished publication changes?",
      "Changes made in this Publication Preview will be lost.",
      "Discard changes",
      true,
    ))
  ) return;
  useApp.getState().cancelFigurePublicationEdit();
}

export async function saveFigureAs(windowId: string): Promise<void> {
  const state = useApp.getState();
  const window = state.plotWindows.find((candidate) => candidate.id === windowId);
  if (!window || window.kind !== "plot") return;
  const { askParams } = await import("../overlays/ParamDialog");
  const params = await askParams("Save editable figure as", [
    { key: "name", label: "Name", type: "text", default: window.title || "Untitled graph" },
  ]);
  if (params) state.saveFigureAs(windowId, String(params.name));
}

/** SAVED figures with unsaved edits get an explicit discard gate on every UI
 *  close path. A window never saved as an editable figure closes plainly —
 *  the close is undoable and the window persists in the workspace, so a
 *  confirm there would violate the confirm-exemption convention and tax the
 *  routine MDI close (see `editableFigureHasUnsavedEdits`'s doc). */
export async function closeFigureWindow(windowId: string): Promise<void> {
  const state = useApp.getState();
  const window = state.plotWindows.find((candidate) => candidate.id === windowId);
  if (!window) return;
  if (window.kind === "plot" && state.plotWindows.filter((candidate) => candidate.kind === "plot").length <= 1) {
    state.closeWindow(windowId);
    return;
  }
  if (
    window.kind === "plot" &&
    editableFigureHasUnsavedEdits(state, window) &&
    !(await askConfirm(
      `Close "${window.title || "Untitled graph"}" without saving?`,
      "Changes to this editable figure will be lost. Use Save first to keep them.",
      "Close without saving",
      true,
    ))
  ) return;
  useApp.getState().closeWindow(windowId);
}
