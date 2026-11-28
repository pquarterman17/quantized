// Plot ▸ Publication preview… acts on the window the user is working in, resolved the way Export figure… does
// (lib/figureTarget): the front plot is previewed; a map in front shows "Publication preview is for plots" with an
// Export map… button (it does NOT run the export itself); anything else that is not a figure is refused with the
// shared reason. Run through the real command (the menu and the palette both run it) and store.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands, figureViewSettled } from "../commands/fileCommands";
import { useApp } from "../store/useApp";
import { useToasts } from "../store/toasts";
import { NO_FIGURE_WINDOW } from "./figureTarget";
import { registerMapExporter, STAGE_MAP_KEY } from "./mapExportBridge";
import { EXPORT_MAP_LABEL, PREVIEW_IS_FOR_PLOTS } from "./publicationPreviewMap";
import type { Dataset } from "./types";

const LINE: Dataset = { id: "d1", name: "line.csv", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["a"], units: [""], metadata: {} } };
const MAP: Dataset = {
  id: "m1", name: "rsm.xrdml",
  data: { time: [0, 1, 2, 3], values: [[1, 1, 5], [1, 2, 6], [2, 1, 7], [2, 2, 8]], labels: ["x", "y", "z"], units: ["", "", ""], metadata: { is2D: true, map_shape: [2, 2] } },
};
const s = () => useApp.getState();
const FRESH = useApp.getState();
const mainId = () => s().plotWindows.find((w) => w.kind === "plot")!.id;
const preview = async () => {
  buildFileCommands(useApp.getState).find((c) => c.id === "figure-builder")!.run();
  await figureViewSettled();
};

beforeAll(async () => {
  await import("../lib/exportFigureView");
});
beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    plotWindows: FRESH.plotWindows, focusedWindowId: FRESH.focusedWindowId, datasets: [LINE, MAP], activeId: "d1",
    stageTab: "plot", layoutMode: "classic", windowLayout: null, figurePublicationSession: null, figureBuilderOpen: false,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  useApp.setState({ figurePublicationSession: null, figureBuilderOpen: false });
});

describe("Publication preview target", () => {
  it("with two plot windows the preview shows the front one, even when the other holds the focus", async () => {
    const first = mainId();
    const second = s().createWindow("d1");
    s().focusWindow(first);
    s().raiseWindow(second); // the second plot is in front, the first still has the focus
    expect(s().focusedWindowId).toBe(first);
    await preview();
    expect(s().figurePublicationSession).toMatchObject({ target: "window", windowId: second });
    expect(s().focusedWindowId).toBe(second);
    expect(s().figureBuilderOpen).toBe(true);
  });

  it("the other way round: raising the first plot previews the first", async () => {
    const first = mainId();
    const second = s().createWindow("d1");
    s().focusWindow(second);
    s().raiseWindow(first);
    await preview();
    expect(s().figurePublicationSession).toMatchObject({ target: "window", windowId: first });
  });

  const previewToast = () => useToasts.getState().toasts.find((t) => t.msg === PREVIEW_IS_FOR_PLOTS);

  it("a map in front shows the message and runs nothing; its Export map… button runs that map's export", async () => {
    const mapId = s().createDocumentWindow("map", "m1");
    const run = vi.fn();
    const off = registerMapExporter(mapId, run);
    await preview();
    expect(run).not.toHaveBeenCalled();
    expect(s().figurePublicationSession).toBeNull();
    expect(s().figureBuilderOpen).toBe(false);
    expect(s().status).toBe(PREVIEW_IS_FOR_PLOTS);
    const toast = previewToast();
    expect(toast?.msg).toBe("Publication preview is for plots. To save this map as a figure, use Export map.");
    expect(toast?.action?.label).toBe("Export map…");
    expect(toast?.action?.label).toBe(EXPORT_MAP_LABEL);
    toast!.action!.onClick();
    off?.();
    expect(run).toHaveBeenCalledTimes(1);
    expect(s().figureBuilderOpen).toBe(false);
  });

  it("the classic Map tab offers the same, and its button runs the stage map's export", async () => {
    s().setActive("m1");
    useApp.setState({ stageTab: "map" });
    const run = vi.fn();
    const off = registerMapExporter(STAGE_MAP_KEY, run);
    await preview();
    expect(run).not.toHaveBeenCalled();
    previewToast()!.action!.onClick();
    off?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the button says so when the map has closed since, instead of doing nothing", async () => {
    s().createDocumentWindow("map", "m1");
    await preview();
    previewToast()!.action!.onClick(); // no exporter registered
    expect(useToasts.getState().toasts.some((t) => /isn't ready to export/.test(t.msg))).toBe(true);
  });

  it("a worksheet beside the plot, with the plot in front, still previews the plot", async () => {
    s().createDocumentWindow("worksheet", "d1");
    s().raiseWindow(mainId());
    await preview();
    expect(s().figurePublicationSession).toMatchObject({ target: "window", windowId: mainId() });
    expect(previewToast()).toBeUndefined();
  });

  it("a worksheet in front is refused with the shared reason, naming why", async () => {
    s().createDocumentWindow("worksheet", "d1");
    await preview();
    expect(s().figurePublicationSession).toBeNull();
    expect(s().figureBuilderOpen).toBe(false);
    expect(s().status).toMatch(/worksheet is the active window, not a figure/);
  });

  it("every window minimized is refused: no figure window is active", async () => {
    for (const w of s().plotWindows) s().minimizeWindow(w.id);
    await preview();
    expect(s().figureBuilderOpen).toBe(false);
    expect(s().status).toBe(NO_FIGURE_WINDOW);
  });

  it("a lone plot window still previews as before", async () => {
    await preview();
    expect(s().figurePublicationSession).toMatchObject({ target: "window", windowId: mainId() });
  });
});
