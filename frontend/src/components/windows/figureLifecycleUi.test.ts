// The F1.4 close gate's two branches (PR #106 review): a never-saved window
// closes plainly (undoable + workspace-persisted — the confirm-exemption
// convention), while a SAVED figure with drifted state gets the discard gate.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import { cancelPublicationPreview, closeFigureWindow } from "./figureLifecycleUi";

const askConfirm = vi.fn();
vi.mock("../overlays/ConfirmDialog", () => ({
  askConfirm: (...args: unknown[]) => askConfirm(...args) as Promise<boolean>,
}));

function secondPlotWindowId(): string {
  const state = useApp.getState();
  const id = state.createWindow(null, undefined, "scratch");
  return id;
}

beforeEach(() => {
  askConfirm.mockReset();
  useApp.setState({ editableFigures: [] });
});

describe("closeFigureWindow", () => {
  it("closes a never-saved window without any confirm", async () => {
    const id = secondPlotWindowId();
    const before = useApp.getState().plotWindows.length;

    await closeFigureWindow(id);

    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().plotWindows).toHaveLength(before - 1);
  });

  it("gates a SAVED figure whose live state drifted, and cancel keeps the window", async () => {
    const id = secondPlotWindowId();
    useApp.getState().saveFigure(id);
    useApp.getState().renameWindow(id, "drifted title");
    const before = useApp.getState().plotWindows.length;

    askConfirm.mockResolvedValueOnce(false);
    await closeFigureWindow(id);
    expect(askConfirm).toHaveBeenCalledOnce();
    expect(useApp.getState().plotWindows).toHaveLength(before);

    askConfirm.mockResolvedValueOnce(true);
    await closeFigureWindow(id);
    expect(useApp.getState().plotWindows).toHaveLength(before - 1);
  });
});

// Item 1: the discard gate the rest of the app applies to non-undoable edit
// loss (closeFigureWindow above), extended to the Publication Preview draft
// — never history-tracked, so unlike a window close there is no Undo.
describe("cancelPublicationPreview", () => {
  const baselineDoc = () => createFigureDocument({
    id: "figure-w1", name: "Current plot", datasetId: "d1", view: defaultPlotView(),
  });

  beforeEach(() => {
    useApp.setState({ figurePublicationSession: null, figureBuilderOpen: false });
  });

  it("prompts before discarding a dirty draft, and declining keeps the session open", async () => {
    const baseline = baselineDoc();
    useApp.setState({
      figurePublicationSession: { target: "new-editable", windowId: null, baseline, draft: { ...baseline, name: "Edited" } },
      figureBuilderOpen: true,
    });
    askConfirm.mockResolvedValueOnce(false);

    await cancelPublicationPreview();

    expect(askConfirm).toHaveBeenCalledOnce();
    expect(useApp.getState().figurePublicationSession).not.toBeNull();
    expect(useApp.getState().figureBuilderOpen).toBe(true);
  });

  it("clears the session once the user confirms discarding a dirty draft", async () => {
    const baseline = baselineDoc();
    useApp.setState({
      figurePublicationSession: { target: "new-editable", windowId: null, baseline, draft: { ...baseline, name: "Edited" } },
      figureBuilderOpen: true,
    });
    askConfirm.mockResolvedValueOnce(true);

    await cancelPublicationPreview();

    expect(useApp.getState().figurePublicationSession).toBeNull();
    expect(useApp.getState().figureBuilderOpen).toBe(false);
  });

  it("clears an unedited (clean) session with no confirm prompt", async () => {
    const baseline = baselineDoc();
    useApp.setState({
      figurePublicationSession: { target: "new-editable", windowId: null, baseline, draft: baseline },
      figureBuilderOpen: true,
    });

    await cancelPublicationPreview();

    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().figurePublicationSession).toBeNull();
  });
});
