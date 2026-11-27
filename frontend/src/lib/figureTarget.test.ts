// Which window the figure commands act on, through the real store: a map window in front exports
// the map, a plot in front the plot, anything else is refused with a reason (never a guess).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../store/useApp";
import { NO_FIGURE_WINDOW, resolveFigureTarget, routeFigureTarget } from "./figureTarget";
import { registerMapExporter, STAGE_MAP_KEY } from "./mapExportBridge";
import type { Dataset } from "./types";

const LINE: Dataset = { id: "d1", name: "line.csv", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["a"], units: [""], metadata: {} } };
const MAP: Dataset = {
  id: "m1", name: "rsm.xrdml",
  data: { time: [0, 1, 2, 3], values: [[1, 1, 5], [1, 2, 6], [2, 1, 7], [2, 2, 8]], labels: ["x", "y", "z"], units: ["", "", ""], metadata: { is2D: true, map_shape: [2, 2] } },
};
const s = () => useApp.getState();
const target = () => resolveFigureTarget(s());
const FRESH = useApp.getState();
const mainId = () => s().plotWindows.find((w) => w.kind === "plot")!.id;

beforeEach(() => {
  useApp.setState({ plotWindows: FRESH.plotWindows, focusedWindowId: FRESH.focusedWindowId, datasets: [LINE, MAP], activeId: "m1", stageTab: "plot", layoutMode: "classic", windowLayout: null });
});
afterEach(() => vi.restoreAllMocks());

describe("resolveFigureTarget", () => {
  it("a plot window alone is the plot", () => {
    expect(target()).toEqual({ kind: "plot" });
  });

  it("a map window raised beside the plot is the target; clicking the plot window takes it back", () => {
    const mapId = s().createDocumentWindow("map", "m1");
    expect(target()).toEqual({ kind: "map", datasetId: "m1", windowId: mapId });
    s().raiseWindow(mainId()); // the frame's click on the focused plot
    expect(target()).toEqual({ kind: "plot" });
  });

  it("a minimized map window is not what the user is working in", () => {
    const mapId = s().createDocumentWindow("map", "m1");
    s().minimizeWindow(mapId);
    expect(target()).toEqual({ kind: "plot" });
  });

  it("a worksheet in front is refused, naming why", () => {
    s().createDocumentWindow("worksheet", "d1");
    expect(target()).toMatchObject({ kind: "none", reason: expect.stringMatching(/worksheet/) });
  });

  it("every window minimized: no figure window is active", () => {
    for (const w of s().plotWindows) s().minimizeWindow(w.id);
    expect(target()).toEqual({ kind: "none", reason: NO_FIGURE_WINDOW });
  });

  it("windows mode ignores a window the layout closed", () => {
    const mapId = s().createDocumentWindow("map", "m1");
    useApp.setState({
      layoutMode: "windows",
      windowLayout: { placements: { [`plot:${mapId}`]: { open: false }, [`plot:${mainId()}`]: { open: true } } } as never,
    });
    expect(target()).toEqual({ kind: "plot" });
    useApp.setState({ windowLayout: { placements: { [`plot:${mapId}`]: { open: true }, [`plot:${mainId()}`]: { open: true } } } as never });
    expect(target()).toMatchObject({ kind: "map", windowId: mapId });
  });

  it("the classic Map tab is the map; the Worksheet tab is not a figure", () => {
    useApp.setState({ stageTab: "map" });
    expect(target()).toEqual({ kind: "map", datasetId: "m1", windowId: null });
    useApp.setState({ stageTab: "worksheet" });
    expect(target()).toMatchObject({ kind: "none" });
  });
});

describe("routeFigureTarget", () => {
  it("lets a plot through and runs the front map window's own export", () => {
    expect(routeFigureTarget(s, "export")).toBe(false);
    const mapId = s().createDocumentWindow("map", "m1");
    const run = vi.fn();
    const off = registerMapExporter(mapId, run);
    expect(routeFigureTarget(s, "export")).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    off();
    expect(routeFigureTarget(s, "export")).toBe(true); // not ready: refused, not exported as a line
    expect(run).toHaveBeenCalledTimes(1);
    expect(s().status).toMatch(/isn't ready/);
  });

  it("uses the Map tab's exporter on the classic stage", () => {
    useApp.setState({ stageTab: "map" });
    const run = vi.fn();
    const off = registerMapExporter(STAGE_MAP_KEY, run);
    expect(routeFigureTarget(s, "export")).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    off();
  });

  it("copy and send refuse for a map instead of copying the sibling plot", () => {
    s().raiseWindow(s().createDocumentWindow("map", "m1"));
    expect(routeFigureTarget(s, "copy")).toBe(true);
    expect(s().status).toMatch(/Copy figure isn't available for a map/);
    expect(routeFigureTarget(s, "send")).toBe(true);
    expect(s().status).toMatch(/Send figure to report/);
  });
});

describe("raising the focused plot", () => {
  it("a click on the focused plot, sitting under a raised map, brings it back to the front", () => {
    const mapId = s().createDocumentWindow("map", "m1");
    expect(mainId()).toBe(s().focusedWindowId);
    s().raiseWindow(mainId());
    expect(target()).toEqual({ kind: "plot" });
    const z = s().plotWindows.map((w) => w.z);
    s().raiseWindow(mainId()); // already on top: no change
    expect(s().plotWindows.map((w) => w.z)).toEqual(z);
    expect(s().plotWindows.find((w) => w.id === mapId)!.z).toBeLessThan(s().plotWindows.find((w) => w.id === mainId())!.z);
  });
});
