// Drag to dock and keyboard move mode (WORKSPACE_LAYOUT_PLAN P2): title-bar
// drags onto each drop zone, a drop elsewhere, Escape, Alt, a floating plot
// window and a floating tool window riding on their own move machinery, the
// move-mode keys, the live region, and classic mode staying out of it. Every
// assertion reads the store or the DOM, never a mock call count.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { close, dock, emptyLayout, float } from "../../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { useApp } from "../../../store/useApp";
import LayoutHost from "./LayoutHost";
import { focusTitleBar } from "./useLayoutKeyboard";

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
const DESK = { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const realRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  // jsdom lays nothing out: the desk is 1000 x 600 at the origin, everything else has no size.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("qzk-wl-desk") ? DESK : realRect.call(this);
  };
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});
afterAll(() => {
  vi.unstubAllGlobals();
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

const DATASET: Dataset = { id: "d1", name: "ds1", data: { time: [0, 1], values: [[1], [2]], labels: ["a"], units: [""], metadata: {} } };
const win = (over: Partial<PlotWindow>): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: "d1",
  geometry: { x: 40, y: 40, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;
const slotOf = (ref: string) => L().placements[ref as "style"]?.slot;
const geo = (id: string) => s().plotWindows.find((w) => w.id === id)!.geometry;

const STYLE_RECT = { x: 200, y: 100, width: 360, height: null, collapsed: false };

function seed(layout: WindowLayoutV1) {
  localStorage.clear();
  useApp.setState({
    datasets: [DATASET],
    activeId: "d1",
    plotWindows: [win({ id: "w1", title: "Graph A", z: 1 }), win({ id: "w2", title: "Graph B", z: 2 })],
    focusedWindowId: "w1",
    layoutMode: "windows",
    windowLayout: layout,
    leftCollapsed: false,
    toolWindowLayout: {},
    plotCanvasBounds: { width: 1000, height: 600 },
  });
}
/** Graph A centre, Graph B floating, Style right. */
const desk = () => dock(float(dock(emptyLayout(), "plot:w1", "centre"), "plot:w2"), "style", "right");
/** Graph A centre, Graph B and Style floating. */
const floats = () => float(float(dock(emptyLayout(), "plot:w1", "centre"), "plot:w2"), "style");

const titleOf = (name: string) => within(screen.getByRole("region", { name })).getByText(name).closest(".qzk-wl-title") as HTMLElement;
const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });
const live = () => screen.getByTestId("wl-live").textContent;
const zone = () => screen.queryByTestId("wl-dropzone")?.getAttribute("data-slot") ?? null;

beforeEach(() => seed(desk()));
afterEach(() => {
  // A test that ends mid-gesture must not leak its window listeners into the next.
  fireEvent.pointerUp(window, pt(0, 0));
});

describe("dragging a docked title bar", () => {
  it.each([
    ["left", 10, 300],
    ["right", 990, 300],
    ["bottom", 500, 590],
    ["centre", 500, 300],
  ] as const)("a drop in the %s zone docks there, with the preview shown while over it", (slot, x, y) => {
    render(<LayoutHost />);
    const from = slot === "centre" ? "Style" : "Graph A";
    fireEvent.pointerDown(titleOf(from), pt(500, 14));
    expect(zone()).toBeNull(); // not a drag until it travels
    fireEvent.pointerMove(window, pt(x, y));
    expect(zone()).toBe(slot);
    expect(screen.getByTestId("wl-zones").textContent).toBe(from); // the ghost label
    fireEvent.pointerUp(window, pt(x, y));
    expect(screen.queryByTestId("wl-zones")).toBeNull();
    expect(slotOf(slot === "centre" ? "style" : "plot:w1")).toBe(slot);
    checkInvariants(L());
  });

  it("a drop elsewhere floats the window at the drop point, keeping its size", () => {
    render(<LayoutHost />);
    fireEvent.pointerDown(titleOf("Graph A"), pt(500, 14));
    fireEvent.pointerMove(window, pt(300, 200));
    expect(zone()).toBeNull();
    fireEvent.pointerUp(window, pt(300, 200));
    expect(slotOf("plot:w1")).toBeNull();
    expect(geo("w1")).toEqual({ x: 300 - 240, y: 200 - 14, w: 480, h: 360 });
    checkInvariants(L());
  });

  it("a press that never travels is not a drag, and a dock button press is not one", () => {
    render(<LayoutHost />);
    const before = L();
    fireEvent.pointerDown(titleOf("Graph A"), pt(500, 14));
    fireEvent.pointerMove(window, pt(502, 15));
    fireEvent.pointerUp(window, pt(502, 15));
    expect(L()).toBe(before);
    fireEvent.pointerDown(within(screen.getByRole("region", { name: "Graph A" })).getByRole("button", { name: "Dock left" }), pt(500, 14));
    fireEvent.pointerMove(window, pt(10, 300));
    expect(zone()).toBeNull();
  });

  it("the desk unmounting mid-drag ends the drag: a later release docks nothing", () => {
    const { unmount } = render(<LayoutHost />);
    fireEvent.pointerDown(titleOf("Graph A"), pt(500, 14));
    fireEvent.pointerMove(window, pt(10, 300));
    expect(zone()).toBe("left");
    unmount();
    const before = L();
    fireEvent.pointerUp(window, pt(10, 300));
    expect(L()).toBe(before);
    expect(slotOf("plot:w1")).toBe("centre");
  });

  it("only the primary button drags", () => {
    render(<LayoutHost />);
    fireEvent.pointerDown(titleOf("Graph A"), { ...pt(500, 14), button: 2 });
    fireEvent.pointerMove(window, pt(10, 300));
    expect(zone()).toBeNull();
  });

  it("holding Alt disables docking: the zone is not shown and a drop floats", () => {
    render(<LayoutHost />);
    fireEvent.pointerDown(titleOf("Graph A"), pt(500, 14));
    fireEvent.pointerMove(window, { ...pt(10, 300), altKey: true });
    expect(zone()).toBeNull();
    fireEvent.pointerUp(window, { ...pt(10, 300), altKey: true });
    expect(slotOf("plot:w1")).toBeNull();
  });

  it("Escape cancels: nothing is docked, floated or moved, and the rest of the drag is ignored", () => {
    render(<LayoutHost />);
    const before = L();
    fireEvent.pointerDown(titleOf("Graph A"), pt(500, 14));
    fireEvent.pointerMove(window, pt(10, 300));
    expect(zone()).toBe("left");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(zone()).toBeNull();
    expect(live()).toBe("Move cancelled, Graph A stays where it was");
    fireEvent.pointerMove(window, pt(990, 300));
    fireEvent.pointerUp(window, pt(990, 300));
    expect(L()).toBe(before);
    expect(slotOf("plot:w1")).toBe("centre");
  });

  it("a pointercancel cancels the same way", () => {
    render(<LayoutHost />);
    const before = L();
    fireEvent.pointerDown(titleOf("Graph A"), pt(500, 14));
    fireEvent.pointerMove(window, pt(10, 300));
    fireEvent.pointerCancel(window, pt(10, 300));
    expect(zone()).toBeNull();
    fireEvent.pointerUp(window, pt(10, 300));
    expect(L()).toBe(before);
  });
});

describe("dragging a floating window", () => {
  const plotBar = () => document.querySelector<HTMLElement>(".qzk-plotwin-titlebar")!;

  it("a floating plot window dropped on a zone docks, and its float rect is unchanged", () => {
    render(<LayoutHost />);
    fireEvent.pointerDown(plotBar(), pt(100, 50));
    fireEvent.pointerMove(window, pt(10, 300));
    expect(zone()).toBe("left");
    fireEvent.pointerUp(window, pt(10, 300));
    expect(slotOf("plot:w2")).toBe("left");
    expect(geo("w2")).toEqual({ x: 40, y: 40, w: 480, h: 360 });
    expect(document.querySelector(".qzk-wl-float .qzk-plotwin")).toBeNull();
  });

  it("dropped outside every zone it just moves, with the frame's own machinery", () => {
    render(<LayoutHost />);
    fireEvent.pointerDown(plotBar(), pt(100, 50));
    fireEvent.pointerMove(window, { ...pt(300, 200), altKey: true }); // Alt: no snapping
    expect(zone()).toBeNull();
    fireEvent.pointerUp(window, { ...pt(300, 200), altKey: true });
    expect(slotOf("plot:w2")).toBeNull();
    expect(geo("w2")).toEqual({ x: 240, y: 190, w: 480, h: 360 });
  });

  it("Escape puts a floating plot window back and the rest of the drag does nothing", () => {
    render(<LayoutHost />);
    fireEvent.pointerDown(plotBar(), pt(100, 50));
    fireEvent.pointerMove(window, pt(300, 200));
    fireEvent.pointerMove(window, pt(10, 300));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(zone()).toBeNull();
    fireEvent.pointerMove(window, pt(500, 400));
    fireEvent.pointerUp(window, pt(500, 400));
    expect(slotOf("plot:w2")).toBeNull();
    expect(geo("w2")).toEqual({ x: 40, y: 40, w: 480, h: 360 });
    const frame = document.querySelector<HTMLElement>(".qzk-wl-float .qzk-plotwin")!;
    expect(frame.style.left).toBe("40px");
    expect(frame.style.top).toBe("40px");
  });

  it("a floating tool window (Style) docks on a zone and keeps its float rect; Escape restores it", async () => {
    seed(floats());
    useApp.setState({ toolWindowLayout: { style: STYLE_RECT } });
    render(<LayoutHost />);
    const bar = await screen.findByRole("group", { name: "Style title bar" });
    fireEvent.pointerDown(bar, pt(300, 110));
    fireEvent.pointerMove(bar, pt(400, 210));
    expect(s().toolWindowLayout.style.x).toBe(300); // its own move
    fireEvent.keyDown(window, { key: "Escape" });
    expect(s().toolWindowLayout.style).toEqual(STYLE_RECT);
    fireEvent.pointerMove(bar, pt(600, 300));
    fireEvent.pointerUp(bar, pt(600, 300));
    expect(s().toolWindowLayout.style).toEqual(STYLE_RECT);
    expect(slotOf("style")).toBeNull();

    fireEvent.pointerDown(bar, pt(300, 110));
    fireEvent.pointerMove(bar, pt(500, 590));
    expect(zone()).toBe("bottom");
    fireEvent.pointerUp(bar, pt(500, 590));
    expect(slotOf("style")).toBe("bottom");
    expect(s().toolWindowLayout.style).toEqual(STYLE_RECT);
  });

  it("a docked Style dropped elsewhere floats as a tool window at the drop point", async () => {
    render(<LayoutHost />);
    fireEvent.pointerDown(titleOf("Style"), pt(900, 14));
    fireEvent.pointerMove(window, pt(300, 200));
    fireEvent.pointerUp(window, pt(300, 200));
    expect(slotOf("style")).toBeNull();
    const at = s().toolWindowLayout.style;
    expect(at).toMatchObject({ width: 360, collapsed: false });
    expect(at.x).toBe(300 - 180);
    expect(at.y).toBe(200 - 14);
    expect(await screen.findByRole("group", { name: "Style title bar" })).toBeTruthy();
  });
});

describe("keyboard move mode (Alt+Shift+M)", () => {
  const press = (key: string, over: Record<string, unknown> = {}) => fireEvent.keyDown(document.body, { key, ...over });
  const enter = (name = "Graph B") => {
    const ref = name === "Style" ? "style" : name === "Graph A" ? "plot:w1" : "plot:w2";
    focusTitleBar(ref as WindowRef);
    fireEvent.keyDown(document.activeElement!, { key: "M", code: "KeyM", altKey: true, shiftKey: true });
  };
  const banner = () => screen.queryByTestId("wl-move-mode");

  it("shows a visible indicator naming the window, and Alt+Shift+M again keeps the placement", () => {
    render(<LayoutHost />);
    expect(banner()).toBeNull();
    enter();
    expect(banner()?.textContent).toContain("Moving Graph B");
    expect(live()).toMatch(/^Move mode on for Graph B/);
    fireEvent.keyDown(window, { key: "M", code: "KeyM", altKey: true, shiftKey: true });
    expect(banner()).toBeNull();
    expect(live()).toBe("Move mode off, Graph B placed");
  });

  it("with no window focused it says so and does not enter the mode", () => {
    useApp.setState({ focusedWindowId: null });
    render(<LayoutHost />);
    fireEvent.keyDown(document.body, { key: "M", code: "KeyM", altKey: true, shiftKey: true });
    expect(banner()).toBeNull();
    expect(live()).toMatch(/^Focus a window first/);
  });

  it("arrows move a floating window 16 px, Shift+arrows 1 px, and announce where it is", () => {
    render(<LayoutHost />);
    enter();
    press("ArrowRight");
    expect(geo("w2")).toMatchObject({ x: 56, y: 40 });
    press("ArrowDown");
    expect(geo("w2")).toMatchObject({ x: 56, y: 56 });
    press("ArrowLeft", { shiftKey: true });
    expect(geo("w2")).toMatchObject({ x: 55, y: 56 });
    press("ArrowUp", { shiftKey: true });
    expect(geo("w2")).toMatchObject({ x: 55, y: 55 });
    press("ArrowLeft");
    press("ArrowLeft");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(geo("w2").x).toBe(0);
    press("ArrowLeft");
    expect(live()).toBe("Graph B is at the edge of the desk");
    expect(geo("w2").x).toBe(0);
  });

  it("arrows move a floating tool window (Style) the same way", async () => {
    seed(floats());
    useApp.setState({ toolWindowLayout: { style: STYLE_RECT } });
    render(<LayoutHost />);
    await screen.findByRole("group", { name: "Style title bar" });
    enter("Style");
    press("ArrowRight");
    press("ArrowDown", { shiftKey: true });
    expect(s().toolWindowLayout.style).toMatchObject({ x: 216, y: 101 });
    expect(live()).toBe("Style moved to 216, 101");
  });

  it("an arrow on a docked window does not move it and says to float it first", () => {
    render(<LayoutHost />);
    enter("Graph A");
    const before = L();
    press("ArrowRight");
    expect(L()).toBe(before);
    expect(live()).toBe("Graph A is docked; press F to float it before moving");
  });

  it.each([
    ["l", "left"],
    ["r", "right"],
    ["b", "bottom"],
    ["c", "centre"],
  ] as const)("%s docks the window %s and announces it", (key, slot) => {
    render(<LayoutHost />);
    enter();
    press(key);
    expect(slotOf("plot:w2")).toBe(slot);
    const n = L().placements["plot:w2"]!;
    expect(live()).toBe(`Graph B docked ${slot}, ${n.order + 1} of ${slot === "right" ? 2 : slot === "centre" ? 2 : 1}`);
    checkInvariants(L());
    // Pressing the slot it is in already says so rather than doing nothing silently.
    press(key);
    expect(live()).toBe(`Graph B is already docked ${slot}`);
  });

  it("F floats a docked window; on a floating one it says so", () => {
    render(<LayoutHost />);
    enter("Graph A");
    press("f");
    expect(slotOf("plot:w1")).toBeNull();
    expect(live()).toBe("Graph A floating");
    press("f");
    expect(live()).toBe("Graph A is already floating");
  });

  it("Enter commits: the mode ends and the placement stays", () => {
    render(<LayoutHost />);
    enter();
    press("l");
    press("Enter");
    expect(banner()).toBeNull();
    expect(slotOf("plot:w2")).toBe("left");
    press("r"); // no longer ours
    expect(slotOf("plot:w2")).toBe("left");
  });

  it("Escape cancels and restores the layout, the float rect and the stacking", () => {
    render(<LayoutHost />);
    const before = L();
    const z = s().plotWindows.find((w) => w.id === "w2")!.z;
    enter();
    press("ArrowRight");
    press("ArrowDown");
    press("c");
    press("f");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(banner()).toBeNull();
    expect(L()).toBe(before);
    expect(geo("w2")).toEqual({ x: 40, y: 40, w: 480, h: 360 });
    expect(s().plotWindows.find((w) => w.id === "w2")!.z).toBe(z);
  });

  it("Escape restores a tool window's float rect, or its absence", async () => {
    seed(floats());
    render(<LayoutHost />);
    await screen.findByRole("group", { name: "Style title bar" });
    enter("Style");
    press("ArrowRight");
    expect(s().toolWindowLayout.style).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(s().toolWindowLayout.style).toBeUndefined();
  });

  it("a window closed while the mode is on ends it: a dock key does not reopen it", () => {
    render(<LayoutHost />);
    enter("Style");
    act(() => s().setWindowLayout(close(L(), "style")));
    press("l");
    expect(banner()).toBeNull();
    expect(L().placements.style?.open).toBe(false);
    expect(live()).toBe("Move mode off, Style is closed");
  });

  it("keys typed into a field are not move keys", () => {
    render(<LayoutHost />);
    enter();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "l" });
    expect(slotOf("plot:w2")).toBeNull();
    input.remove();
  });

  it("is only claimed while windows mode's host is mounted", () => {
    const before = L();
    fireEvent.keyDown(document.body, { key: "M", code: "KeyM", altKey: true, shiftKey: true });
    expect(L()).toBe(before);
    expect(screen.queryByTestId("wl-move-mode")).toBeNull();
  });
});

describe("live region announcements", () => {
  it("is a polite live region (not a second status role: the host's notice owns that one)", () => {
    render(<LayoutHost />);
    const region = screen.getByTestId("wl-live");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
  });

  it("a dock button, pressing it again, and the toolbar commands are announced", () => {
    render(<LayoutHost />);
    expect(live()).toBe(""); // the first layout is silent
    const style = screen.getByRole("region", { name: "Style" });
    fireEvent.click(within(style).getByRole("button", { name: "Dock left" }));
    expect(live()).toBe("Style docked left, 1 of 1");
    fireEvent.click(within(screen.getByRole("region", { name: "Style" })).getByRole("button", { name: "Dock left" }));
    expect(live()).toBe("Style floating");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "⊞ Tile all" }));
    });
    expect(live()).toBe("Graph B docked centre, 2 of 2"); // Style is not tiled; Graph A was already there
    fireEvent.click(screen.getByRole("button", { name: "⧉ Float all" }));
    expect(live()).toBe("2 windows floating");
  });

  it("a drag drop and a close are announced too", () => {
    render(<LayoutHost />);
    fireEvent.pointerDown(titleOf("Graph A"), pt(500, 14));
    fireEvent.pointerMove(window, pt(10, 300));
    fireEvent.pointerUp(window, pt(10, 300));
    expect(live()).toBe("Graph A docked left, 1 of 1");
    fireEvent.click(within(screen.getByRole("region", { name: "Style" })).getByRole("button", { name: "Close Style" }));
    expect(live()).toBe("Style closed");
  });
});
