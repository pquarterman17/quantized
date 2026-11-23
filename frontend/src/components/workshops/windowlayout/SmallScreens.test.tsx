// Small screens, owner decision D6 (WORKSPACE_LAYOUT_PLAN P5). By default the
// windows stay floating below ~1280 px and a resize re-arranges nothing. With
// Preferences ▸ Small screens ▸ "Tile below a width" on, the windows tile while
// the viewport is narrower than that width, and widening gives the user's own
// layout back: the width rule never overwrites it (a save writes it too).
// Every assertion reads the store or the DOM.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { dock, emptyLayout, float, stackOf } from "../../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import type { WindowLayoutV1 } from "../../../lib/windowLayout/types";
import { windowLayoutForSave } from "../../../lib/workspaceWindowLayout";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { loadPrefs, PREFS_KEY } from "../../../store/prefs";
import { useApp } from "../../../store/useApp";
import { WindowLayoutPref } from "../../overlays/WindowLayoutPref";
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
  disconnect(): void {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

const DATASET: Dataset = { id: "d1", name: "ds1", data: { time: [0, 1], values: [[1], [2]], labels: ["a"], units: [""], metadata: {} } };
const win = (over: Partial<PlotWindow>): PlotWindow => ({
  id: "w1", kind: "plot", title: "", datasetId: "d1", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 0, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;

/** The user's own desk: Graph A in the centre, Style docked right, Graph B floating, a sized right edge. */
const desk = (): WindowLayoutV1 => {
  let l = dock(emptyLayout(), "plot:w1", "centre");
  l = float(l, "plot:w2");
  l = dock(l, "style", "right");
  l = { ...l, placements: { ...l.placements, data: { slot: "right", order: 1, share: 0.5, lastSlot: "right", open: false } } };
  return { ...l, edges: { left: 0, right: 440, bottom: 0 } };
};

/** Resize the viewport the way a browser does: the width, then a resize event. */
const resizeTo = (width: number) =>
  act(() => {
    (window as { innerWidth: number }).innerWidth = width;
    window.dispatchEvent(new Event("resize"));
  });

beforeEach(() => {
  localStorage.clear();
  (window as { innerWidth: number }).innerWidth = 1440;
  useApp.setState({
    datasets: [DATASET], activeId: "d1",
    plotWindows: [win({ id: "w1", title: "Graph A", z: 1 }), win({ id: "w2", title: "Graph B", z: 2 })],
    focusedWindowId: "w1", layoutMode: "windows", windowLayout: desk(), leftCollapsed: false, stageTab: "plot", layoutTileBelow: 0,
  });
});
afterEach(() => void ((window as { innerWidth: number }).innerWidth = 1024));

describe("the default: windows stay floating on a small screen (D6)", () => {
  it("resizing across 1280 px either way re-arranges nothing", () => {
    render(<LayoutHost />);
    const before = L();
    resizeTo(1024);
    expect(L()).toBe(before);
    resizeTo(1440);
    expect(L()).toBe(before);
    expect(L().tiled).toBeUndefined();
  });

  it("the pref fails closed to floating: missing, not a number, or outside 600-3,840 px all read as 0", () => {
    expect(loadPrefs().layoutTileBelow).toBe(0);
    for (const bad of ["1280", null, -5, 300, 599, 5000]) {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ layoutTileBelow: bad }));
      expect(loadPrefs().layoutTileBelow).toBe(0);
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify({ layoutTileBelow: 1100.4 }));
    expect(loadPrefs().layoutTileBelow).toBe(1100);
  });
});

describe("tile below a width", () => {
  beforeEach(() => useApp.setState({ layoutTileBelow: 1280 }));

  it("narrower than the width, every window on screen tiles in the centre; wider again, the user's layout is back exactly", () => {
    render(<LayoutHost />);
    const mine = L();
    expect(mine.tiled).toBeUndefined(); // 1440 px: nothing happens
    resizeTo(1024);
    expect(stackOf(L(), "centre")).toEqual(["plot:w1", "style", "plot:w2"]);
    expect(L().centre).toBe("grid");
    expect(L().z).toEqual([]);
    checkInvariants(L());
    expect(screen.getByTestId("wl-live").textContent).toContain("narrower than 1280 px");
    resizeTo(1440);
    expect(L()).toEqual(mine);
    expect(screen.getByTestId("wl-live").textContent).toContain("Your window layout is back.");
  });

  it("widening gives the plot windows back untouched: a maximized floating one stays maximized, z and rects unchanged", () => {
    useApp.setState({ plotWindows: [win({ id: "w1", title: "Graph A", z: 1 }), win({ id: "w2", title: "Graph B", z: 7, winState: "maximized", geometry: { x: 40, y: 40, w: 480, h: 360 } })] });
    render(<LayoutHost />);
    const plots = s().plotWindows;
    resizeTo(1024);
    resizeTo(1440);
    expect(s().plotWindows).toEqual(plots);
    expect(L().placements["plot:w2"]).toMatchObject({ slot: null, open: true });
  });

  it("the saved layout is never overwritten: a save and the per-user template while tiled are the user's layout", async () => {
    render(<LayoutHost />);
    const mine = L();
    resizeTo(1024);
    fireEvent.click(screen.getByRole("button", { name: "⧉ Float all" })); // a rearrangement while narrow
    expect(L().tiled).toBeDefined();
    expect(windowLayoutForSave(s())).toEqual(mine);
    // The template is written through the layout chunk (a dynamic import): wait on what it wrote.
    const template = () => JSON.parse(localStorage.getItem("qz.windowLayout") ?? "null") as { kinds: { style: { slot: string } }; edges: { right: number } } | null;
    await expect.poll(() => template()?.edges.right).toBe(440);
    expect(template()!.kinds.style.slot).toBe("right");
    resizeTo(1440);
    expect(L()).toEqual(mine); // the Float all made while narrow is not kept
  });

  it("a window opened while narrow joins the tile and is still open after widening, where it was saved", () => {
    render(<LayoutHost />);
    resizeTo(1024);
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    expect(L().placements.data).toMatchObject({ open: true, slot: "centre" });
    resizeTo(1440);
    expect(L().placements.data).toMatchObject({ open: true, slot: "right" });
    expect(L().tiled).toBeUndefined();
  });

  it("a width just at the threshold is not narrow; a resize within the narrow range changes nothing", () => {
    render(<LayoutHost />);
    resizeTo(1280);
    expect(L().tiled).toBeUndefined();
    resizeTo(1100);
    const tiled = L();
    resizeTo(900);
    expect(L()).toBe(tiled);
  });

  it("switching the setting back to Keep floating while narrow gives the layout back", () => {
    render(<LayoutHost />);
    render(<WindowLayoutPref />);
    const mine = L();
    resizeTo(1024);
    expect(L().tiled).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: "Keep floating" }));
    expect(s().layoutTileBelow).toBe(0);
    expect(L()).toEqual(mine);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).layoutTileBelow).toBe(0);
  });

  it("the Preferences row turns tiling on at 1280 px and takes another width", () => {
    useApp.setState({ layoutTileBelow: 0 });
    render(<WindowLayoutPref />);
    expect(screen.queryByLabelText("Tile below width (px)")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Tile below a width" }));
    expect(s().layoutTileBelow).toBe(1280);
    fireEvent.change(screen.getByLabelText("Tile below width (px)"), { target: { value: "1100" } });
    expect(s().layoutTileBelow).toBe(1100);
  });

  it("classic mode shows no Small screens row", () => {
    useApp.setState({ layoutMode: "classic" });
    render(<WindowLayoutPref />);
    expect(screen.queryByText("Small screens")).toBeNull();
  });
});
