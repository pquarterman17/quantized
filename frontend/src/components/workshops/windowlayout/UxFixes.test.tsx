// UX pass 1 fixes for the window layout (preview): the last plot's Close, focus
// after closing Style, the move banner and the stage-view notice living in the
// toolbar row, a floating Style never above the desk, disabled-button feedback,
// the way back to classic, F6 landing on the title bar, Alt+Shift+M from the
// Library, the cancelled-move announcement, Tile all leaving Style alone, and
// the empty-centre hint under a floating window. Assertions read the store or
// the DOM, never a mock call count.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { dock, emptyLayout, float } from "../../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import type { WindowLayoutV1 } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { LAST_PLOT_REASON } from "../../../store/windowLayoutActions";
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

const DESK_TOP = 102;
const realRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  // jsdom lays nothing out: the float layer (the desk's box) starts below the toolbar.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("qzk-wl-float") ? ({ left: 0, top: DESK_TOP, width: 800, height: 500, right: 800, bottom: 602, x: 0, y: DESK_TOP, toJSON: () => ({}) } as DOMRect) : realRect.call(this);
  };
});
afterAll(() => {
  vi.unstubAllGlobals();
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

const DATASET: Dataset = { id: "d1", name: "ds1", data: { time: [0, 1], values: [[1], [2]], labels: ["a"], units: [""], metadata: {} } };
const win = (over: Partial<PlotWindow>): PlotWindow => ({
  id: "w1", kind: "plot", title: "Graph A", datasetId: "d1", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;
const live = () => screen.getByTestId("wl-live").textContent;

function seed(layout: WindowLayoutV1, windows: PlotWindow[]) {
  localStorage.clear();
  useApp.setState({
    datasets: [DATASET], activeId: "d1", plotWindows: windows, focusedWindowId: windows[0]?.id ?? null,
    layoutMode: "windows", windowLayout: layout, leftCollapsed: false, toolWindowLayout: {}, stageTab: "plot",
  });
}
const two = () => [win({ id: "w1", title: "Graph A" }), win({ id: "w2", title: "Graph B", z: 2 })];
const dockedDesk = () => dock(dock(dock(emptyLayout(), "plot:w1", "centre"), "plot:w2", "centre"), "style", "right");

afterEach(() => void ((window as { innerWidth: number }).innerWidth = 1024));

describe("m1 the last plot window's Close", () => {
  it("is disabled with its reason, and a click says why instead of doing nothing", () => {
    seed(dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), [win({})]);
    render(<LayoutHost />);
    const btn = within(screen.getByRole("region", { name: "Graph A" })).getByRole("button", { name: "Close Graph A" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("title")).toBe(LAST_PLOT_REASON);
    fireEvent.click(btn);
    expect(live()).toBe(LAST_PLOT_REASON);
    expect(s().statusWarn).toBe(LAST_PLOT_REASON);
    expect(s().plotWindows).toHaveLength(1);
  });

  it("is enabled while another plot window exists", () => {
    seed(dockedDesk(), two());
    render(<LayoutHost />);
    const btn = within(screen.getByRole("region", { name: "Graph A" })).getByRole("button", { name: "Close Graph A" });
    expect(btn.getAttribute("aria-disabled")).toBeNull();
  });
});

describe("m2 focus after closing Style", () => {
  it("lands on the toolbar's Style toggle", async () => {
    seed(dockedDesk(), two());
    render(<LayoutHost />);
    fireEvent.click(within(screen.getByRole("region", { name: "Style" })).getByRole("button", { name: "Close Style" }));
    expect(L().placements.style!.open).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Style" })));
  });
});

describe("m3 the move banner and m7 the stage-view notice live in the toolbar row", () => {
  it("the banner is inside the toolbar, not over the desk", () => {
    seed(dockedDesk(), two());
    const { container } = render(<LayoutHost />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "M", code: "KeyM", altKey: true, shiftKey: true });
    const banner = screen.getByTestId("wl-move-mode");
    expect(banner.closest('[role="toolbar"]')).not.toBeNull();
    expect(container.querySelector(".qzk-wl-desk")!.contains(banner)).toBe(false);
  });

  it("a Worksheet request takes over the toolbar row, and the stage tab is put back so Style keeps its sections", () => {
    seed(dockedDesk(), two());
    render(<LayoutHost />);
    act(() => useApp.setState({ stageTab: "worksheet" }));
    const toolbar = screen.getByRole("toolbar", { name: "Window layout" });
    expect(within(toolbar).getByRole("status").textContent).toContain("The Worksheet view is not in the window layout yet.");
    expect(s().stageTab).toBe("plot");
    expect(within(toolbar).queryByRole("button", { name: "⊞ Tile all" })).toBeNull();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Dismiss" }));
    expect(within(toolbar).getByRole("button", { name: "⊞ Tile all" })).toBeTruthy();
  });
});

describe("m4 floating Style opens below the toolbar", () => {
  it("at the desk's top (never above it), and a saved rect above the top is brought down", async () => {
    seed(float(dock(emptyLayout(), "plot:w1", "centre"), "style"), [win({})]);
    const { unmount } = render(<LayoutHost />);
    const el = await waitFor(() => {
      const e = document.querySelector<HTMLElement>('[data-tool-window="style"]');
      expect(e).not.toBeNull();
      return e!;
    });
    expect(parseInt(el.style.top, 10)).toBeGreaterThanOrEqual(DESK_TOP);
    unmount();
    seed(float(dock(emptyLayout(), "plot:w1", "centre"), "style"), [win({})]);
    useApp.setState({ toolWindowLayout: { style: { x: 120, y: 90, width: 360, height: null, collapsed: false } } });
    render(<LayoutHost />);
    await waitFor(() => expect(s().toolWindowLayout.style!.y).toBeGreaterThanOrEqual(DESK_TOP));
  });
});

describe("m6 a disabled Plot | Data gives feedback", () => {
  it("a click says why in the status line and the live region", () => {
    seed(dockedDesk(), two());
    useApp.setState({ focusedWindowId: null });
    render(<LayoutHost />);
    const btn = screen.getByRole("button", { name: "▥ Plot | Data side by side" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(live()).toMatch(/No plot window is focused/);
    expect(s().statusWarn).toMatch(/No plot window is focused/);
    expect(L().placements.data?.open).not.toBe(true);
  });
});

describe("m9 the way back to classic", () => {
  it("the toolbar's Classic layout button leaves the layout and keeps it", async () => {
    seed(dockedDesk(), two());
    render(<LayoutHost />);
    fireEvent.click(screen.getByRole("button", { name: /Classic layout/ }));
    await waitFor(() => expect(s().layoutMode).toBe("classic"));
    expect(s().windowLayout).not.toBeNull();
  });
});

describe("m11 F6 and Alt+Shift+M", () => {
  it("F6 focuses the title bar of a docked window", () => {
    seed(dockedDesk(), two());
    useApp.setState({ leftCollapsed: true }); // no Library stop in this test
    render(<LayoutHost />);
    fireEvent.keyDown(window, { key: "F6" });
    expect(document.activeElement?.classList.contains("qzk-wl-title")).toBe(true);
  });

  it("Alt+Shift+M with focus in the Library moves nothing and says how to use it", () => {
    seed(dockedDesk(), two());
    render(
      <>
        <div className="qzk-library">
          <button type="button">lib</button>
        </div>
        <LayoutHost />
      </>,
    );
    screen.getByText("lib").focus();
    fireEvent.keyDown(document.activeElement!, { key: "M", code: "KeyM", altKey: true, shiftKey: true });
    expect(screen.queryByTestId("wl-move-mode")).toBeNull();
    expect(live()).toMatch(/Library does not move.*F6/);
  });
});

describe("m12 Escape out of move mode", () => {
  it("announces the cancel, not the restore", () => {
    seed(dockedDesk(), two());
    render(<LayoutHost />);
    fireEvent.keyDown(document.body, { key: "M", code: "KeyM", altKey: true, shiftKey: true });
    const target = screen.getByTestId("wl-move-mode").textContent!.match(/Moving (Graph [AB])/)![1];
    fireEvent.keyDown(window, { key: "L" });
    expect(L().placements[target === "Graph A" ? "plot:w1" : "plot:w2"]!.slot).toBe("left");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(L().placements[target === "Graph A" ? "plot:w1" : "plot:w2"]!.slot).toBe("centre");
    expect(live()).toBe(`Move mode cancelled, ${target} stays where it was`);
  });
});

describe("p1 / p3 / p5", () => {
  it("Float all puts Style against the right edge, not over the first plot window", async () => {
    (window as { innerWidth: number }).innerWidth = 1440;
    seed(dockedDesk(), two());
    render(<LayoutHost />);
    fireEvent.click(screen.getByRole("button", { name: "⧉ Float all" }));
    const el = await waitFor(() => {
      const e = document.querySelector<HTMLElement>('[data-tool-window="style"]');
      expect(e).not.toBeNull();
      return e!;
    });
    expect(parseInt(el.style.left, 10)).toBeGreaterThanOrEqual(1440 - 360 - 16);
  });

  it("the empty-centre hint is not drawn under a floating window", () => {
    seed(float(dock(emptyLayout(), "style", "right"), "plot:w1"), [win({})]);
    render(<LayoutHost />);
    expect(screen.queryByText(/Nothing is docked in the centre/)).toBeNull();
    fireEvent.click(within(document.querySelector(".qzk-wl-float") as HTMLElement).getByRole("button", { name: "Dock centre" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Graph A" })).getByRole("button", { name: "Dock centre" })); // float again
    expect(L().placements["plot:w1"]!.slot).toBeNull();
  });

  it("the hint shows when nothing floats either", () => {
    seed(dock(emptyLayout(), "style", "right"), [win({})]);
    useApp.setState({ plotWindows: [win({ winState: "minimized" })] });
    render(<LayoutHost />);
    expect(screen.getByText(/Nothing is docked in the centre/)).toBeTruthy();
  });

  it("Tile all leaves a floating Style floating", () => {
    seed(float(dock(dock(emptyLayout(), "plot:w1", "centre"), "plot:w2", "right"), "style"), two());
    render(<LayoutHost />);
    fireEvent.click(screen.getByRole("button", { name: "⊞ Tile all" }));
    expect(L().placements["plot:w2"]!.slot).toBe("centre");
    expect(L().placements.style!.slot).toBeNull();
  });
});

describe("m10 target size and contrast tokens", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "windowlayout.css"), "utf8");
  it("dock buttons and Close are 24 x 24, the pressed glyph and the caption use the readable text tokens", () => {
    expect(css).toMatch(/\.qzk-wl-dockbtn, \.qzk-wl-close \{ width: 24px; height: 24px;/);
    expect(css).toMatch(/\[aria-pressed="true"\] \{ background: var\(--accent-soft\); color: var\(--accent-text\); \}/);
    expect(css).toMatch(/\.qzk-wl-where \{[^}]*color: var\(--text-dim\)/);
  });
});
