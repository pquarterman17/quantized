// Plot ▸ Publication preview… acts on the window the user is working in, resolved the way Export figure… does
// (lib/figureTarget): the front plot, a map in front runs its own Export map, and anything that is not a figure
// is refused with the shared reason. Run through the real command and store.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands, figureViewSettled } from "../commands/fileCommands";
import { useApp } from "../store/useApp";
import { NO_FIGURE_WINDOW } from "./figureTarget";
import { registerMapExporter } from "./mapExportBridge";
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

  it("a map in front runs that map's own export and opens no preview", async () => {
    const mapId = s().createDocumentWindow("map", "m1");
    const run = vi.fn();
    const off = registerMapExporter(mapId, run);
    await preview();
    off?.();
    expect(run).toHaveBeenCalledTimes(1);
    expect(s().figurePublicationSession).toBeNull();
    expect(s().figureBuilderOpen).toBe(false);
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
