// UX pass 2 fixes for the window layout: a window never opens out of sight (M1: Data starts closed-and-floating on a small screen, and reopen floats a window that a floating plot would hide), the Data title bar keeps its mode text (M2),
// pin/close never shrink (m-1), the linked chip (m-2), Escape out of move mode
// returns focus (m-3), the switch-on toast lives longer (m-4), the Data source
// is announced (m-5), splitters name what they resize (m-6) and the Preferences
// footer is accurate (m-7). Assertions read the store or the DOM.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { dock, emptyLayout, float } from "../../../lib/windowLayout/ops";
import { slotBox, slotHidden } from "../../../lib/windowLayout/visibility";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { reopenRef } from "../../../store/windowLayoutActions";
import { WINDOW_LAYOUT_TOAST_MS } from "../../../store/windowLayoutRun";
import LayoutHost from "./LayoutHost";

vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../Stage/worksheet/WorksheetPane", () => ({ default: () => <div data-testid="grid" /> }));
vi.mock("../../windows/BackgroundPlotWindow", () => ({ default: ({ windowId }: { windowId: string }) => <div data-testid={`bg-${windowId}`} /> }));
vi.mock("../../Inspector/Inspector", () => ({ default: () => <aside className="qzk-inspector" data-testid="inspector" /> }));
vi.mock("../../windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("../../history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));
vi.mock("../../../commands/recentProjectsCommands", () => ({ useRecentProjectsCommands: () => {} }));
vi.mock("../../../commands/relinkCommands", () => ({ useRelinkCommands: () => {} }));
vi.mock("../../../commands/workbookTransferCommands", () => ({ useWorkbookTransferCommands: () => {} }));
vi.mock("../../../commands/projectLockCommands", () => ({ useProjectLockCommands: () => {} }));

const here = dirname(fileURLToPath(import.meta.url));
const realRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("qzk-wl-float") ? ({ left: 0, top: 102, width: 800, height: 500, right: 800, bottom: 602, x: 0, y: 102, toJSON: () => ({}) } as DOMRect) : realRect.call(this);
  };
});
afterAll(() => {
  vi.unstubAllGlobals();
  HTMLElement.prototype.getBoundingClientRect = realRect;
});
afterEach(() => {
  (window as { innerWidth: number }).innerWidth = 1024;
  vi.useRealTimers();
});

const mkData = (n: string): Dataset => ({ id: n, name: `sample-${n}`, data: { time: [0, 1], values: [[1], [2]], labels: ["a"], units: [""], metadata: {} } });
const D1 = mkData("d1");
const D2 = mkData("d2");
const win = (id: string, datasetId: string, over: Partial<PlotWindow> = {}): PlotWindow => ({
  id, kind: "plot", title: `Graph ${id}`, datasetId, geometry: { x: 0, y: 0, w: 800, h: 500 }, z: 1,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;
const live = () => screen.getByTestId("wl-live").textContent;

function setup(layout = dock(dock(dock(dock(emptyLayout(), "plot:w1", "centre"), "plot:w2", "centre"), "style", "left"), "data", "right"), windows = [win("w1", "d1"), win("w2", "d2", { z: 2 })]) {
  localStorage.clear();
  useApp.setState({
    datasets: [D1, D2], activeId: "d1", worksheetId: null, selectedIds: ["d1"], selection: null, worksheetSelections: {},
    plotWindows: windows, focusedWindowId: "w1", layoutMode: "windows", windowLayout: layout, leftCollapsed: false, toolWindowLayout: {},
  });
}
const dataFrame = () => screen.getByRole("region", { name: "Data" });

describe("M1 a window never opens out of sight on a small screen", () => {
  it("turning the layout on at 1024 px floats the plot and Style (D6), and leaves classic's geometry and maximize exactly as they were, also after switching back", async () => {
    const before = { geometry: { x: 40, y: 40, w: 480, h: 360 }, winState: "maximized" as const };
    setup(undefined, [win("w1", "d1", before)]);
    useApp.setState({ windowLayout: null, layoutMode: "classic" });
    await act(() => s().setLayoutMode("windows"));
    await waitFor(() => expect(s().windowLayout).not.toBeNull());
    expect(L().placements["plot:w1"]).toMatchObject({ slot: null, open: true });
    expect(L().placements.style).toMatchObject({ slot: null, open: true });
    expect(L().placements.data).toMatchObject({ slot: null, open: false, lastSlot: "right" });
    await act(() => s().setLayoutMode("classic"));
    expect(s().layoutMode).toBe("classic");
    const w = s().plotWindows[0];
    expect(w.geometry).toEqual(before.geometry);
    expect(w.winState).toBe("maximized");
  });

  it("a covered slot is detected by one float that spans it, not by one that leaves it clear", () => {
    const right = slotBox("right", 380, { width: 800, height: 500 });
    expect(slotHidden(right, [{ x: 0, y: 0, w: 800, h: 500 }])).toBe(true);
    expect(slotHidden(right, [{ x: 0, y: 0, w: 430, h: 500 }])).toBe(false);
  });

  it("reopening Data floats it when a floating plot covers the whole right edge, and docks it when not", () => {
    const base = float(dock(emptyLayout(), "style", "left"), "plot:w1");
    const closedData = { ...base, placements: { ...base.placements, data: { slot: "right" as const, order: 0, share: 1, lastSlot: "right" as const, open: false } } };
    setup(closedData, [win("w1", "d1")]);
    const desk = document.createElement("div");
    desk.className = "qzk-wl-desk";
    desk.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.append(desk);
    try {
      reopenRef("data");
      expect(L().placements.data).toMatchObject({ slot: null, open: true });
      // Close it again and narrow the plot: now it docks at its remembered edge.
      useApp.setState({ windowLayout: closedData, plotWindows: [win("w1", "d1", { geometry: { x: 0, y: 0, w: 400, h: 500 } })] });
      reopenRef("data");
      expect(L().placements.data).toMatchObject({ slot: "right", open: true });
    } finally {
      desk.remove();
    }
  });
});

describe("M2 the Data title bar keeps its mode text", () => {
  it("has no 'docked' caption, and the pin's name and tooltip carry the mode", () => {
    setup();
    render(<LayoutHost />);
    const frame = dataFrame();
    expect(frame.querySelector(".qzk-wl-where")).toBeNull();
    expect(within(frame).getByTestId("data-source").textContent).toBe("sample-d1 · following the plot");
    const pin = within(frame).getByRole("button", { name: "Pin the Data window (following the plot)" });
    expect(pin.getAttribute("title")).toMatch(/following the plot/);
    fireEvent.click(pin);
    const pinned = within(frame).getByRole("button", { name: "Pin the Data window (pinned)" });
    expect(pinned.getAttribute("title")).toMatch(/^Pinned to this dataset/);
  });

  it("other windows keep their placement caption", () => {
    setup();
    render(<LayoutHost />);
    expect(within(screen.getByRole("region", { name: "Style" })).getByText("docked left")).toBeTruthy();
  });

  it("a 200 px dock lets the title shrink so Close stays inside the bar", () => {
    expect(readFileSync(join(here, "windowlayout.css"), "utf8")).toMatch(/@container \(max-width: 230px\) \{ \.qzk-wl-title-text \{ min-width: 0; \} \}/);
  });

  it("the source text, not the 'Data' label, takes the spare width in the title bar", () => {
    const css = readFileSync(join(here, "windowlayout.css"), "utf8");
    expect(css).toMatch(/\.qzk-wl-title-text:has\(\+ \.qzk-wl-data-src\) \{ flex: 0 0 auto; \}/);
  });
});

describe("m-1 title-bar buttons never shrink", () => {
  it("dock, pin and Close are flex:none with a 24 px minimum", () => {
    const css = readFileSync(join(here, "windowlayout.css"), "utf8");
    expect(css).toMatch(/\.qzk-wl-dockbtn, \.qzk-wl-close \{ width: 24px; height: 24px; flex: none; min-width: 24px; min-height: 24px;/);
  });
});

describe("m-2 the linked chip", () => {
  it("shows while the Data window follows the plot's own dataset, and not when pinned or following the Library", () => {
    setup();
    render(<LayoutHost />);
    expect(within(dataFrame()).getByTestId("data-linked").textContent).toBe("linked");
    fireEvent.click(within(dataFrame()).getByRole("button", { name: /^Pin the Data window/ }));
    expect(within(dataFrame()).queryByTestId("data-linked")).toBeNull();
    fireEvent.click(within(dataFrame()).getByRole("button", { name: /^Pin the Data window/ })); // follow again
    expect(within(dataFrame()).getByTestId("data-linked")).toBeTruthy();
    act(() => s().setWindowLayout({ ...L(), data: { pinned: null, follow: "library" } }));
    expect(within(dataFrame()).queryByTestId("data-linked")).toBeNull();
  });
});

describe("m-3 Escape out of move mode", () => {
  it("returns focus to the window's title bar", () => {
    setup(dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), [win("w1", "d1")]);
    render(<LayoutHost />);
    fireEvent.keyDown(document.body, { key: "M", code: "KeyM", altKey: true, shiftKey: true });
    expect(screen.getByTestId("wl-move-mode")).toBeTruthy();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "L" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("wl-move-mode")).toBeNull();
    expect(document.activeElement?.classList.contains("qzk-wl-title")).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Graph w1 title bar");
  });
});

describe("m-4 the switch-on toast", () => {
  it("lasts at least 10 s and waits while hovered or focused", async () => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
    useApp.setState({ layoutMode: "classic", windowLayout: null, plotWindows: [win("w1", "d1")] });
    await act(async () => {
      await s().setLayoutMode("windows");
      await vi.advanceTimersByTimeAsync(50);
    });
    const t = useToasts.getState().toasts.find((x) => /Window layout is on/.test(x.msg));
    expect(t).toBeTruthy();
    expect(WINDOW_LAYOUT_TOAST_MS).toBeGreaterThanOrEqual(10_000);
    await act(() => vi.advanceTimersByTimeAsync(WINDOW_LAYOUT_TOAST_MS - 1000));
    expect(useToasts.getState().toasts.some((x) => x.id === t!.id)).toBe(true);
    act(() => useToasts.getState().hold(t!.id, true));
    await act(() => vi.advanceTimersByTimeAsync(WINDOW_LAYOUT_TOAST_MS * 2));
    expect(useToasts.getState().toasts.some((x) => x.id === t!.id)).toBe(true);
    act(() => useToasts.getState().hold(t!.id, false));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(useToasts.getState().toasts.some((x) => x.id === t!.id)).toBe(false);
  });
});

describe("m-5 the Data source is announced", () => {
  it("says what the Data window shows when the focus, the pin or the dataset changes, and nothing at the first render", () => {
    setup();
    render(<LayoutHost />);
    expect(live()).toBe("");
    act(() => s().focusWindow("w2"));
    expect(live()).toBe("Data shows sample-d2, following the plot");
    fireEvent.click(within(dataFrame()).getByRole("button", { name: /^Pin the Data window/ }));
    expect(live()).toBe("Data shows sample-d2, pinned");
  });
});

describe("m-6 splitters name what they resize and say their value", () => {
  it("an edge splitter names its dock and windows and reads its size in px; a stack splitter its split", () => {
    setup(dock(dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), "data", "right"), [win("w1", "d1")]);
    render(<LayoutHost />);
    const edge = screen.getByRole("separator", { name: "Resize the right dock (Style, Data)" });
    expect(Number(edge.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(Number(edge.getAttribute("aria-valuemin"))).toBe(200); // no plot docked here: the plain edge minimum
    expect(Number(edge.getAttribute("aria-valuemax"))).toBeGreaterThanOrEqual(Number(edge.getAttribute("aria-valuenow")));
    expect(edge.getAttribute("aria-valuetext")).toBe(`${edge.getAttribute("aria-valuenow")} px`);
    const inner = screen.getByRole("separator", { name: "Resize Style and Data" });
    expect(inner.getAttribute("aria-valuenow")).toBe("50");
    expect(inner.getAttribute("aria-valuetext")).toBe("Style 50%, Data 50%");
    expect(inner.getAttribute("aria-valuemin")).toBe("0");
    expect(inner.getAttribute("aria-valuemax")).toBe("100");
    fireEvent.keyDown(inner, { key: "ArrowDown" });
    expect(Number(screen.getByRole("separator", { name: "Resize Style and Data" }).getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(50);
  });
});

describe("m-7 the Preferences footer", () => {
  it("does not claim every change stays on this machine", () => {
    // The footer lives in PrefsResetBar.tsx since PREFS_AUDIT lane 1 (shortened copy).
    const src = readFileSync(join(here, "../../overlays/PrefsResetBar.tsx"), "utf8");
    expect(src).not.toMatch(/persist on this machine/);
    expect(src).toMatch(/The window layout itself is saved with the project\./);
  });
});
