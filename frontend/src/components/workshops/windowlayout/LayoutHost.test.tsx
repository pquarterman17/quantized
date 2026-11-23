// The window-layout host (WORKSPACE_LAYOUT_PLAN P1): regions rendered from a
// layout, the title-bar dock buttons (dock, and pressing the pressed one
// floats), Close, the toolbar's Dock all / Float all / Tile all, the
// Plot | Data button, splitters, re-seeding a missing layout, and F6.
// Every assertion reads the store or the DOM, never a mock call count.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { dock, emptyLayout, float } from "../../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import type { WindowLayoutV1 } from "../../../lib/windowLayout/types";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { useApp } from "../../../store/useApp";
import { useCommands } from "../../../store/commands";
import { inspectorShown, toggleInspector } from "../../../store/inspectorToggle";
import { toolDockSnapshot } from "../../../store/toolDock";
import ToolWindow from "../../overlays/ToolWindow";
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

function seed(layout: WindowLayoutV1 | null, windows: PlotWindow[]) {
  localStorage.clear();
  useApp.setState({
    datasets: [DATASET],
    activeId: "d1",
    plotWindows: windows,
    focusedWindowId: windows[0]?.id ?? null,
    layoutMode: "windows",
    windowLayout: layout,
    leftCollapsed: false,
  });
}

const twoWindows = () => [win({ id: "w1", title: "Graph A", winState: "maximized", z: 1 }), win({ id: "w2", title: "Graph B", z: 2 })];
const desk = () => {
  let l = dock(emptyLayout(), "plot:w1", "centre");
  l = float(l, "plot:w2");
  return dock(l, "style", "right");
};

const wide = () => void ((window as { innerWidth: number }).innerWidth = 1440);
afterEach(() => void ((window as { innerWidth: number }).innerWidth = 1024));
const frame = (name: string) => screen.getByRole("region", { name });
const dockBtn = (scope: HTMLElement, label: string) => within(scope).getByRole("button", { name: label });

beforeEach(() => seed(desk(), twoWindows()));

describe("LayoutHost renders the regions of a layout", () => {
  it("docked windows are named regions in their slot; a floating plot window is a classic frame", async () => {
    const { container } = render(<LayoutHost />);
    const a = frame("Graph A");
    expect(a.closest("[data-slot]")?.getAttribute("data-slot")).toBe("centre");
    expect(frame("Style").closest("[data-slot]")?.getAttribute("data-slot")).toBe("right");
    expect(await within(a).findByTestId("plot-stage")).toBeTruthy();
    const floating = container.querySelector(".qzk-wl-float .qzk-plotwin");
    expect(floating?.textContent).toContain("Graph B");
    expect(await screen.findByTestId("inspector")).toBeTruthy();
    // No left or bottom region when nothing is docked there.
    expect(container.querySelector('[data-slot="left"]')).toBeNull();
    expect(container.querySelector('[data-slot="bottom"]')).toBeNull();
  });

  it("several centre windows share it side by side, several on an edge stack along it", () => {
    let l = dock(desk(), "plot:w2", "centre");
    l = dock(l, "plot:w3", "right");
    seed(l, [...twoWindows(), win({ id: "w3", title: "Graph C" })]);
    const { container } = render(<LayoutHost />);
    const centre = container.querySelector('[data-slot="centre"]')!;
    expect(centre.getAttribute("data-axis")).toBe("x");
    expect(within(centre as HTMLElement).getAllByRole("region").map((r) => r.getAttribute("data-wl-window"))).toEqual(["plot:w1", "plot:w2"]);
    const right = container.querySelector('[data-slot="right"]')!;
    expect(right.getAttribute("data-axis")).toBe("y");
    expect(within(right as HTMLElement).getAllByRole("region")).toHaveLength(2);
    expect(within(centre as HTMLElement).getAllByRole("separator")).toHaveLength(1);
  });
});

describe("title-bar dock buttons", () => {
  it("are real buttons with names, and only the current slot shows pressed", () => {
    render(<LayoutHost />);
    const style = frame("Style");
    expect(dockBtn(style, "Dock right").getAttribute("aria-pressed")).toBe("true");
    for (const name of ["Dock left", "Dock bottom", "Dock centre"]) expect(dockBtn(style, name).getAttribute("aria-pressed")).toBe("false");
    expect(within(style).getByRole("button", { name: "Close Style" })).toBeTruthy();
  });

  it("docks to another slot, and pressing the pressed button again floats the window", async () => {
    const { container } = render(<LayoutHost />);
    fireEvent.click(dockBtn(frame("Style"), "Dock left"));
    expect(L().placements.style!.slot).toBe("left");
    expect(frame("Style").closest("[data-slot]")?.getAttribute("data-slot")).toBe("left");
    checkInvariants(L());

    fireEvent.click(dockBtn(frame("Style"), "Dock left"));
    expect(L().placements.style).toMatchObject({ slot: null, lastSlot: "left", open: true });
    expect(L().z.at(-1)).toBe("style");
    // Floating Style is a tool window (the existing move/resize frame).
    await waitFor(() => expect(document.querySelector('[data-tool-window="style"]')).not.toBeNull());
    expect(container.querySelector('[data-slot="left"]')).toBeNull();
  });

  it("a floating plot window carries the dock buttons too, and docking a maximized one is safe to float back", () => {
    render(<LayoutHost />);
    const floating = document.querySelector<HTMLElement>(".qzk-wl-float .qzk-plotwin")!;
    fireEvent.click(dockBtn(floating, "Dock bottom"));
    expect(L().placements["plot:w2"]!.slot).toBe("bottom");
    expect(frame("Graph B").closest("[data-slot]")?.getAttribute("data-slot")).toBe("bottom");

    // w1 was maximized while docked centre: floating it restores its normal rect.
    fireEvent.click(dockBtn(frame("Graph A"), "Dock centre"));
    expect(L().placements["plot:w1"]!.slot).toBeNull();
    expect(s().plotWindows.find((w) => w.id === "w1")!.winState).toBe("normal");
  });

  it("Close keeps a singleton's placement, and the toolbar pill reopens it where it was", () => {
    render(<LayoutHost />);
    fireEvent.click(within(frame("Style")).getByRole("button", { name: "Close Style" }));
    expect(L().placements.style).toMatchObject({ open: false, slot: "right" });
    expect(screen.queryByRole("region", { name: "Style" })).toBeNull();
    const pill = screen.getByRole("button", { name: "Style" });
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pill);
    expect(L().placements.style).toMatchObject({ open: true, slot: "right" });
    expect(frame("Style")).toBeTruthy();
  });
});

describe("toolbar arrange commands", () => {
  it("Float all floats every docked window, cascading one that would land on another", () => {
    seed(desk(), [win({ id: "w1", title: "Graph A", winState: "maximized" }), win({ id: "w2", title: "Graph B" })]);
    render(<LayoutHost />);
    fireEvent.click(screen.getByRole("button", { name: "⧉ Float all" }));
    expect(document.querySelectorAll("[data-wl-window]")).toHaveLength(0);
    expect(L().placements["plot:w1"]!.slot).toBeNull();
    expect(L().placements.style!.slot).toBeNull();
    checkInvariants(L());
    const [g1, g2] = s().plotWindows.map((w) => w.geometry);
    expect([g1.x, g1.y]).not.toEqual([g2.x, g2.y]);
    expect(document.querySelectorAll(".qzk-wl-float .qzk-plotwin")).toHaveLength(2);
  });

  it("Dock all puts the focused plot in the centre and Style on the right", () => {
    seed(float(float(emptyLayout(), "plot:w1"), "style"), twoWindows());
    render(<LayoutHost />);
    fireEvent.click(screen.getByRole("button", { name: "▦ Dock all" }));
    expect(L().placements["plot:w1"]!.slot).toBe("centre");
    expect(L().placements.style!.slot).toBe("right");
    expect(frame("Graph A").closest("[data-slot]")?.getAttribute("data-slot")).toBe("centre");
    checkInvariants(L());
  });

  it("Tile all shares the centre between every open window as a grid", () => {
    render(<LayoutHost />);
    fireEvent.click(screen.getByRole("button", { name: "⊞ Tile all" }));
    expect(L().centre).toBe("grid");
    const centre = document.querySelector('[data-slot="centre"]') as HTMLElement;
    expect(centre.classList.contains("grid")).toBe(true);
    // Style (the Inspector) is not a tile: it stays docked right.
    expect(within(centre).getAllByRole("region")).toHaveLength(2);
    expect(L().placements.style).toMatchObject({ slot: "right", open: true });
    checkInvariants(L());
  });

  it("Plot | Data is enabled while a plot window is focused (P3; DataWindow.test.tsx covers what it does)", () => {
    render(<LayoutHost />);
    const btn = screen.getByRole("button", { name: "▥ Plot | Data side by side" });
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    expect(btn.getAttribute("title")).toMatch(/Data window/);
  });
});

describe("Window menu and palette commands", () => {
  it("are published while the host is mounted, run the same arrange ops, and leave with it", () => {
    const { unmount } = render(<LayoutHost />);
    const cmd = (id: string) => useCommands.getState().menuCommands.find((a) => a.id === id);
    expect(cmd("layout-tile-all")?.group).toBe("Window");
    expect((cmd("layout-plot-data")?.disabled as () => boolean)()).toBe(false);
    act(() => cmd("layout-float-all")!.run());
    expect(L().placements.style!.slot).toBeNull();
    act(() => cmd("layout-dock-all")!.run());
    expect(L().placements.style!.slot).toBe("right");
    unmount();
    expect(cmd("layout-dock-all")).toBeUndefined();
  });
});

describe("fail-closed edges of the preview", () => {
  it("a tool placement (seeded from a docked tool) is kept but never drawn, tiled or focused", () => {
    seed(dock(desk(), "tool:curvefit", "right"), twoWindows());
    render(<LayoutHost />);
    expect(document.querySelector('[data-wl-window="tool:curvefit"]')).toBeNull();
    expect(within(document.querySelector('[data-slot="right"]') as HTMLElement).getAllByRole("region")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "⊞ Tile all" }));
    expect(L().placements["tool:curvefit"]!.slot).toBe("right");
    expect(L().placements.style!.slot).toBe("right");
  });

  it("a dock-capable tool window floats instead of claiming the side column", () => {
    render(<ToolWindow id="curvefit" title="Curve fit" dockable>body</ToolWindow>);
    expect(toolDockSnapshot().owner).toBeNull();
    expect(document.querySelector('[data-tool-window="curvefit"]')?.hasAttribute("data-docked")).toBe(false);
  });

  it("⌘] and the Inspector toggle act on the Style window while the host is mounted", () => {
    const { unmount } = render(<LayoutHost />);
    expect(inspectorShown()).toBe(true);
    act(() => toggleInspector());
    expect(L().placements.style!.open).toBe(false);
    expect(inspectorShown()).toBe(false);
    act(() => toggleInspector());
    expect(L().placements.style).toMatchObject({ open: true, slot: "right" });
    unmount();
    useApp.setState({ rightCollapsed: false });
    expect(inspectorShown()).toBe(true);
  });

  it("a request for a stage view the preview cannot show says so and offers the classic layout", async () => {
    render(<LayoutHost />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => useApp.setState({ stageTab: "worksheet" }));
    expect(screen.getByRole("status").textContent).toContain("The Worksheet view is not in the window layout yet.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(s().stageTab).toBe("plot");
    act(() => useApp.setState({ stageTab: "map" }));
    fireEvent.click(screen.getByRole("button", { name: "Open the classic layout" }));
    await expect.poll(() => s().layoutMode).toBe("classic");
  });

  it("a floated plot window comes in front of the floating ones, and Dock all ends a Tile all grid", () => {
    render(<LayoutHost />);
    fireEvent.click(dockBtn(frame("Graph A"), "Dock centre"));
    const z = (id: string) => s().plotWindows.find((w) => w.id === id)!.z;
    expect(z("w1")).toBeGreaterThan(z("w2"));
    fireEvent.click(screen.getByRole("button", { name: "⊞ Tile all" }));
    expect(L().centre).toBe("grid");
    fireEvent.click(screen.getByRole("button", { name: "▦ Dock all" }));
    expect(L().centre).toBe("row");
  });
});

describe("splitters", () => {
  it("an edge splitter's arrow keys resize the edge and the size persists in the layout", () => {
    render(<LayoutHost />);
    const split = screen.getByRole("separator", { name: "Resize the right edge" });
    fireEvent.keyDown(split, { key: "ArrowLeft" });
    expect(L().edges.right).toBe(380 + 16);
    fireEvent.keyDown(split, { key: "ArrowRight", shiftKey: true });
    expect(L().edges.right).toBe(380 + 15);
  });

  it("a drag commits once, on release", () => {
    render(<LayoutHost />);
    const split = screen.getByRole("separator", { name: "Resize the right edge" });
    fireEvent.pointerDown(split, { button: 0, clientX: 500 });
    fireEvent.pointerMove(split, { clientX: 440 });
    expect(L().edges.right).toBe(0);
    fireEvent.pointerUp(split, { clientX: 440 });
    expect(L().edges.right).toBe(440);
  });
});

describe("layout upkeep", () => {
  it("windows mode with no layout re-seeds one from the classic desk", async () => {
    seed(null, twoWindows());
    wide();
    render(<LayoutHost />);
    await waitFor(() => expect(s().windowLayout).not.toBeNull());
    expect(L().placements["plot:w1"]!.slot).toBe("centre");
    expect(await screen.findByRole("region", { name: "Style" })).toBeTruthy();
  });

  it("a new plot window docks to the centre; a removed one loses its placement", () => {
    render(<LayoutHost />);
    act(() => useApp.setState({ plotWindows: [...s().plotWindows, win({ id: "w3", title: "Graph C" })] }));
    expect(L().placements["plot:w3"]).toMatchObject({ slot: "centre", open: true });
    act(() => useApp.setState({ plotWindows: s().plotWindows.filter((w) => w.id !== "w2") }));
    expect(L().placements["plot:w2"]).toBeUndefined();
    checkInvariants(L());
  });
});

describe("F6 cycles window focus in layout order", () => {
  it("Library, then the centre, the right edge and the floating window, wrapping; Shift+F6 goes back", () => {
    render(
      <>
        <div className="qzk-library">
          <button type="button">lib</button>
        </div>
        <LayoutHost />
      </>,
    );
    const press = (shiftKey = false) => fireEvent.keyDown(window, { key: "F6", shiftKey });
    // F6 lands on the title bar: a docked frame marks it, a floating frame's bar holds the marked group.
    const at = () => {
      const el = document.activeElement;
      return (el?.closest("[data-wl-focus]") ?? el?.querySelector("[data-wl-focus]"))?.getAttribute("data-wl-focus") ?? el?.textContent;
    };
    press();
    expect(at()).toBe("lib");
    press();
    expect(at()).toBe("plot:w1");
    press();
    expect(at()).toBe("style");
    press();
    expect(at()).toBe("plot:w2");
    // Focusing the floating plot window made it the app's focused window.
    expect(s().focusedWindowId).toBe("w2");
    press();
    expect(at()).toBe("lib");
    press(true);
    expect(at()).toBe("plot:w2");
  });
});
