// Map as a plot type in a plot window (WORKSPACE_LAYOUT_PLAN P5). Windows mode
// has no Map stage tab: every request for it (the stage-tab call sites, routed
// through ONE adapter, ./stageTabAdapter) opens the active dataset's map window,
// whose body is the real MapStage with the Map toolbar ON THE PLOT (inside the
// window's frame), docked in the centre, or floating under 1280 px (D6).
// Every assertion reads the store or the DOM.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { EMPTY_MAP_VIEWS } from "../../../lib/mapView";
import { contourFromScattered } from "../../../lib/scatteredContour";
import { plotIntentStageTab } from "../../../lib/stagetab";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { lineInsteadOfMap } from "../../../store/firstPlotNotice";
import { NO_DATASET, NOT_A_MAP } from "../../../store/windowLayoutMap";
import LayoutHost from "./LayoutHost";

vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../windows/BackgroundPlotWindow", () => ({ default: ({ windowId }: { windowId: string }) => <div data-testid={`bg-${windowId}`} /> }));
vi.mock("../../Inspector/Inspector", () => ({ default: () => <aside className="qzk-inspector" data-testid="inspector" /> }));
vi.mock("../../windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("../../history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));
vi.mock("../../../commands/recentProjectsCommands", () => ({ useRecentProjectsCommands: () => {} }));
vi.mock("../../../commands/relinkCommands", () => ({ useRelinkCommands: () => {} }));
vi.mock("../../../commands/workbookTransferCommands", () => ({ useWorkbookTransferCommands: () => {} }));
vi.mock("../../../commands/projectLockCommands", () => ({ useProjectLockCommands: () => {} }));

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline"))); // the map regrids on the client
});
afterAll(() => vi.unstubAllGlobals());

/** A 4 x 4 XRDML-style reciprocal-space map (the MapStage tests' fixture shape). */
function rsm(id = "m1", name = "rsm.xrdml", extra: Record<string, unknown> = {}): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) values.push([30 + i, 15 + j, 100 * (i + 1) + j]);
  return {
    id, name,
    data: { time: values.map((_, k) => k), values, labels: ["2Theta", "Omega", "Intensity"], units: ["deg", "deg", "counts"], metadata: { is2D: true, map_shape: [4, 4], ...extra } },
  };
}
const LINE: Dataset = { id: "d1", name: "line.csv", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["a"], units: [""], metadata: {} } };
const win = (over: Partial<PlotWindow>): PlotWindow => ({
  id: "w1", kind: "plot", title: "Graph A", datasetId: "m1", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;
const mapWindows = () => s().plotWindows.filter((w) => w.kind === "map");
const width = (px: number) => void ((window as { innerWidth: number }).innerWidth = px);

beforeEach(() => {
  localStorage.clear();
  width(1440);
  useApp.setState({
    datasets: [rsm(), LINE], activeId: "m1", plotWindows: [win({})], focusedWindowId: "w1", layoutMode: "windows",
    windowLayout: dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), leftCollapsed: false,
    stageTab: "plot", mapViews: EMPTY_MAP_VIEWS, status: "", layoutTileBelow: 0,
  });
});
afterEach(() => width(1024));

describe("a Map request in windows mode opens a map window", () => {
  it("1440 px: the map window docks in the centre beside the plot, with the Map toolbar on the plot", async () => {
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    expect(s().stageTab).toBe("plot"); // the tab is put back at once (the Style window follows it)
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
    const ref = `plot:${mapWindows()[0].id}` as const;
    expect(L().placements[ref]).toMatchObject({ slot: "centre", open: true });
    const frame = screen.getByRole("region", { name: "rsm.xrdml" });
    // Toolbar placement: the map's own toolbar is inside the map window's frame, never in the layout toolbar.
    const contours = await within(frame).findByRole("button", { name: "Contours" });
    expect(contours.closest(".qzk-float-tools")).not.toBeNull();
    expect(contours.closest("[data-wl-window]")).toBe(frame.closest("[data-wl-window]") ?? frame);
    expect(within(screen.getByRole("toolbar", { name: "Window layout" })).queryByRole("button", { name: "Contours" })).toBeNull();
    expect(screen.queryByText(/view is not in the window layout yet/)).toBeNull();
  });

  it("under 1280 px the new map window floats, in front (D6)", async () => {
    width(1024);
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
    const ref = `plot:${mapWindows()[0].id}` as const;
    expect(L().placements[ref]).toMatchObject({ slot: null, open: true });
    expect(L().z.at(-1)).toBe(ref);
    expect(await screen.findByRole("button", { name: "Contours" })).toBeTruthy();
  });

  it("a second request brings the same window forward (one map window per dataset), restoring a minimized one", async () => {
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
    const id = mapWindows()[0].id;
    act(() => s().minimizeWindow(id));
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(s().plotWindows.find((w) => w.id === id)!.winState).toBe("normal"));
    expect(mapWindows()).toHaveLength(1);
  });

  it("a dataset that cannot be drawn as a map opens nothing and says why", async () => {
    useApp.setState({ activeId: "d1" });
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(s().status).toBe(NOT_A_MAP));
    expect(mapWindows()).toHaveLength(0);
    expect(s().stageTab).toBe("plot");
  });
});

describe("fail closed and the way back", () => {
  it("a Map request with no active dataset opens nothing and says why", async () => {
    useApp.setState({ activeId: null });
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(s().status).toBe(NO_DATASET));
    expect(mapWindows()).toHaveLength(0);
  });

  it("the import notice's \"Line plot\" closes the map window it opened (windows mode); classic goes back to the Plot tab", async () => {
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
    act(() => lineInsteadOfMap(s(), "m1"));
    expect(mapWindows()).toHaveLength(0);
    await waitFor(() => expect(Object.keys(L().placements).filter((r) => r.startsWith("plot:"))).toEqual(["plot:w1"]));
    useApp.setState({ layoutMode: "classic", stageTab: "map" });
    lineInsteadOfMap(s(), "m1");
    expect(s().stageTab).toBe("plot");
  });
});

describe("the stage-tab call sites, each routed through the adapter", () => {
  it("store/datasetSelection activateFromLibrary: an Origin matrix book (its Map route) opens its map window", async () => {
    useApp.setState({ datasets: [rsm(), LINE, rsm("m2", "matrix", { origin_matrix: { name: "MBook1" } })] });
    render(<LayoutHost />);
    act(() => s().activateFromLibrary("m2"));
    await waitFor(() => expect(mapWindows().map((w) => w.datasetId)).toEqual(["m2"]));
    expect(s().stageTab).toBe("plot");
  });

  it("store/useApp setActive (nextStageTab): activating a 2-D map dataset opens its map window", async () => {
    useApp.setState({ activeId: "d1" });
    render(<LayoutHost />);
    act(() => s().setActive("m1"));
    await waitFor(() => expect(mapWindows().map((w) => w.datasetId)).toEqual(["m1"]));
  });

  it("store/analysisCenterRun's reveal (plotIntentStageTab) for a map opens the map window; for a 1-D dataset it stays on the plot", async () => {
    render(<LayoutHost />);
    act(() => s().setStageTab(plotIntentStageTab(LINE)));
    expect(mapWindows()).toHaveLength(0);
    act(() => s().setStageTab(plotIntentStageTab(rsm())));
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
  });

  it("lib/scatteredContour (Plot > Contour) on a map dataset opens the map window", async () => {
    render(<LayoutHost />);
    act(() => contourFromScattered());
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
  });

  it("store/analysisResultPlotOpen's stageTab \"plot\" patch changes nothing in windows mode (no notice, no window)", () => {
    render(<LayoutHost />);
    const before = L();
    act(() => useApp.setState({ stageTab: "plot" }));
    expect(L()).toBe(before);
    expect(mapWindows()).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
