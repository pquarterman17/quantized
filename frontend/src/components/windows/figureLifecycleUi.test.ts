// The F1.4 close gate's two branches (PR #106 review): a never-saved window
// closes plainly (undoable + workspace-persisted — the confirm-exemption
// convention), while a SAVED figure with drifted state gets the discard gate.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import { closeFigureWindow } from "./figureLifecycleUi";

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
