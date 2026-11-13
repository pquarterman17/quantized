import { displayedWindowTitle } from "../../lib/plotview";
import { editableFigureHasUnsavedEdits, figurePublicationDirty, styledWindowCloseNeedsConfirm } from "../../store/figureUnsavedEdits";
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
  ], { confirmLabel: "Save" });
  if (params) state.saveFigureAs(windowId, String(params.name));
}

/** SAVED figures with unsaved edits get an explicit discard gate on every UI
 *  close path, and so does a window the user styled but never saved (figures
 *  audit #15). A default window closes plainly — it holds nothing to lose. */
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
  if (
    styledWindowCloseNeedsConfirm(state, window) &&
    !(await askConfirm(
      `Close "${displayedWindowTitle(window, state.datasets)}"?`,
      "This graph's styling (titles, error bars, axes, annotations) is not saved as a figure. Edit ▸ Undo restores the window; Save first to keep it in the Library.",
      "Close window",
      true,
    ))
  ) return;
  useApp.getState().closeWindow(windowId);
}
