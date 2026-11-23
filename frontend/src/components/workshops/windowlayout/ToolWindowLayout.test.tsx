// Analysis tools as layout windows (WORKSPACE_LAYOUT_PLAN P4, D7/D8): a tool
// opens as its own `tool:<id>` window (bottom by default), one per tool, never
// registering the classic side-column dock; its close closes the tool and the
// window reopens where it was; re-docking moves the tool's DOM (its state
// survives); the pin freezes a pinnable tool's input the way the shared
// resolver expects, a non-pinnable tool says why it cannot be pinned, a run
// pins a following tool automatically, and a pin lost to another tool is said.
// Classic mode keeps the classic frame and the side-column dock exactly.
// Every assertion reads the store or the DOM, never a mock call count.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { analysisTargetDataset } from "../../../lib/analysisInputs";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { seedAnalysisSelection, useAnalysisSelection } from "../../../store/analysisSelection";
import { isToolMounted, layoutTool, resetLayoutToolsForTests } from "../../../store/layoutTools";
import { resetToolDockForTests, toolDockSnapshot } from "../../../store/toolDock";
import { useApp } from "../../../store/useApp";
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

const sheet = (id: string, name: string): Dataset => ({
  id,
  name,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: [""], metadata: {} },
});
const win = (id: string, datasetId: string, z: number): PlotWindow => ({
  id, kind: "plot", title: `Graph ${id}`, datasetId, geometry: { x: 40, y: 40, w: 480, h: 360 }, z, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
});

const s = () => useApp.getState();
const L = () => s().windowLayout!;

function seed(mode: "windows" | "classic" = "windows") {
  localStorage.clear();
  resetLayoutToolsForTests();
  resetToolDockForTests();
  useAnalysisSelection.getState().clear();
  useApp.setState({
    datasets: [sheet("d1", "Sample one"), sheet("d2", "Sample two")],
    activeId: "d1",
    selectedIds: ["d1"],
    plotWindows: [win("w1", "d1", 2), win("w2", "d2", 1)],
    focusedWindowId: "w1",
    layoutMode: mode,
    windowLayout: dock(dock(emptyLayout(), "plot:w1", "centre"), "plot:w2", "left"),
    leftCollapsed: false,
    status: "",
  });
}
beforeEach(() => seed());
afterEach(() => resetLayoutToolsForTests());

/** A workshop: its own open flag, a stateful body, and the ToolWindow. */
function Workshop({ id = "curvefit", title = "Curve Fit", busy = false }: { id?: string; title?: string; busy?: boolean }) {
  const [open, setOpen] = useState(true);
  const [count, setCount] = useState(0);
  if (!open) return <button onClick={() => setOpen(true)}>reopen {id}</button>;
  return (
    <ToolWindow id={id} title={title} busy={busy} onClose={() => setOpen(false)}>
      <button onClick={() => setCount((n) => n + 1)}>count {count}</button>
    </ToolWindow>
  );
}

const frame = (name: string) => screen.getByRole("region", { name });
/** The tool registered and the host opened its window. */
const mounted = async (id: string) => {
  await expect.poll(() => isToolMounted(id)).toBe(true);
  await expect.poll(() => s().windowLayout?.placements[`tool:${id}`]?.open).toBe(true);
};
const live = () => screen.getByTestId("wl-live").textContent;

describe("tools open as layout windows", () => {
  it("opens docked at the bottom with the tool's body inside, and never claims the side column", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    expect(L().placements["tool:curvefit"]).toMatchObject({ open: true, slot: "bottom" });
    expect(within(frame("Curve Fit")).getByRole("button", { name: "count 0" })).toBeTruthy();
    expect(toolDockSnapshot().owner).toBeNull();
    checkInvariants(L());
    // It takes focus on open: its title bar.
    await waitFor(() => expect(document.activeElement?.closest('[data-wl-window="tool:curvefit"]')).not.toBeNull());
  });

  it("one window per tool: reopening an open tool only focuses it", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    const before = L();
    const { reopenRef } = await import("../../../store/windowLayoutActions");
    act(() => reopenRef("tool:curvefit"));
    expect(L().placements["tool:curvefit"]).toEqual(before.placements["tool:curvefit"]);
    expect(screen.getAllByRole("region", { name: "Curve Fit" })).toHaveLength(1);
  });

  it("re-docking moves the tool's DOM: its local state survives", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    fireEvent.click(within(frame("Curve Fit")).getByRole("button", { name: "count 0" }));
    fireEvent.click(within(frame("Curve Fit")).getByRole("button", { name: "Dock right" }));
    expect(L().placements["tool:curvefit"]!.slot).toBe("right");
    expect(within(frame("Curve Fit")).getByRole("button", { name: "count 1" })).toBeTruthy();
  });

  it("Close closes the tool itself; reopening the tool puts its window back where it was", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    fireEvent.click(within(frame("Curve Fit")).getByRole("button", { name: "Dock right" }));
    fireEvent.click(within(frame("Curve Fit")).getByRole("button", { name: "Close Curve Fit" }));
    expect(screen.getByRole("button", { name: "reopen curvefit" })).toBeTruthy();
    expect(isToolMounted("curvefit")).toBe(false);
    expect(L().placements["tool:curvefit"]).toMatchObject({ open: false, slot: "right" });
    fireEvent.click(screen.getByRole("button", { name: "reopen curvefit" }));
    await mounted("curvefit");
    expect(L().placements["tool:curvefit"]).toMatchObject({ open: true, slot: "right" });
  });

  it("Escape in a docked tool closes it, as in a floating one", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    const btn = within(frame("Curve Fit")).getByRole("button", { name: "count 0" });
    btn.focus();
    fireEvent.keyDown(btn, { key: "Escape" });
    await expect.poll(() => isToolMounted("curvefit")).toBe(false);
  });

  it("floats in the classic frame at its own rect, with the dock buttons and its body", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    fireEvent.click(within(frame("Curve Fit")).getByRole("button", { name: "Dock bottom" }));
    expect(L().placements["tool:curvefit"]!.slot).toBeNull();
    await expect.poll(() => document.querySelector('[data-tool-window="curvefit"]')).not.toBeNull();
    const float = document.querySelector('[data-tool-window="curvefit"]') as HTMLElement;
    expect(within(float).getByRole("button", { name: "count 0" })).toBeTruthy();
    expect(within(float).getByRole("button", { name: "Dock bottom" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("a saved window for a tool this version does not have is dropped, and named", async () => {
    useApp.setState({ windowLayout: dock(dock(L(), "tool:warp-drive", "bottom"), "tool:baseline", "bottom") });
    render(<LayoutHost />);
    await expect.poll(() => L().placements["tool:warp-drive"]).toBeUndefined();
    expect(L().placements["tool:baseline"]).toBeDefined();
    expect(s().status).toBe("Window layout: 1 tool window not restored (warp-drive: not a tool this version has).");
  });

  it("a tool placement whose tool is closed is not drawn, and closes", async () => {
    useApp.setState({ windowLayout: dock(L(), "tool:baseline", "bottom") });
    render(<LayoutHost />);
    expect(document.querySelector('[data-wl-window="tool:baseline"]')).toBeNull();
    await expect.poll(() => L().placements["tool:baseline"]!.open).toBe(false);
    expect(L().placements["tool:baseline"]!.slot).toBe("bottom");
  });
});

describe("tool windows follow the focused plot, with a pin", () => {
  const pinBtn = (name = "Curve Fit") => within(frame(name)).getByRole("button", { name: new RegExp(`^Pin ${name}`) });

  it("the pin freezes the tool's input on its dataset (a non-live handoff); unpin follows again", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    expect(pinBtn().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pinBtn());
    expect(L().pins).toEqual({ "tool:curvefit": "d1" });
    expect(useAnalysisSelection.getState()).toMatchObject({ toolId: "curvefit", selection: { source: "plot", items: [{ datasetId: "d1" }] } });
    act(() => s().focusWindow("w2"));
    expect(s().activeId).toBe("d2");
    expect(useAnalysisSelection.getState().selection?.items[0]?.datasetId).toBe("d1");
    expect(within(frame("Curve Fit")).getByTestId("tool-pin-curvefit").textContent).toContain("pinned to Sample one");
    fireEvent.click(pinBtn());
    expect(L().pins).toEqual({});
    expect(useAnalysisSelection.getState().selection).toMatchObject({ source: "tool-default", items: [{ datasetId: "d2" }] });
  });

  it("a pinned tool whose dataset is deleted refuses (the resolver's handoff rule), never switches", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    fireEvent.click(pinBtn());
    act(() => useApp.setState({ datasets: [sheet("d2", "Sample two")], activeId: "d2" }));
    const sel = useAnalysisSelection.getState().selection!;
    expect(analysisTargetDataset(s().datasets, s().activeId, sel.items[0], sel.source === "tool-default")).toBeNull();
  });

  it("a tool that reads the plot directly cannot be pinned, and says why", async () => {
    render(<><LayoutHost /><Workshop id="baseline" title="Baseline" /></>);
    await mounted("baseline");
    expect(pinBtn("Baseline").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(pinBtn("Baseline"));
    expect(L().pins ?? {}).toEqual({});
    expect(live()).toBe("Baseline reads the focused plot directly, so it follows the plot and cannot be pinned yet.");
  });

  it("a run pins a following tool for its duration, and says so both ways", async () => {
    const { rerender } = render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    rerender(<><LayoutHost /><Workshop busy /></>);
    await expect.poll(() => layoutTool("curvefit")?.autoPin).toBe("d1");
    expect(s().status).toBe("Curve Fit is pinned to Sample one while it runs.");
    expect(L().pins ?? {}).toEqual({}); // a run's pin is never saved
    act(() => s().focusWindow("w2"));
    expect(useAnalysisSelection.getState().selection?.items[0]?.datasetId).toBe("d1");
    rerender(<><LayoutHost /><Workshop busy={false} /></>);
    await expect.poll(() => layoutTool("curvefit")?.autoPin).toBeNull();
    expect(useAnalysisSelection.getState().selection).toMatchObject({ source: "tool-default", items: [{ datasetId: "d2" }] });
    expect(live()).toBe("Curve Fit finished and follows the focused plot again");
  });

  it("a pin lost to another tool taking the shared selection is dropped, and said", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    fireEvent.click(pinBtn());
    act(() => void seedAnalysisSelection("peaks", "tool-default"));
    expect(L().pins).toEqual({});
    expect(s().status).toMatch(/^Curve Fit is no longer pinned: another tool took the shared input selection/);
  });

  it("a saved pin is restored when the tool opens: its input is frozen on that dataset", async () => {
    useApp.setState({ windowLayout: { ...L(), pins: { "tool:curvefit": "d2" } } });
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    expect(useAnalysisSelection.getState()).toMatchObject({ toolId: "curvefit", selection: { source: "plot", items: [{ datasetId: "d2" }] } });
  });
});

describe("classic mode is unchanged", () => {
  it("the classic frame and the side-column dock, no layout window", () => {
    seed("classic");
    render(<ToolWindow id="curvefit" title="Curve Fit" dockable onClose={() => {}}>body</ToolWindow>);
    // Synchronous: the classic frame, not the lazy layout chunk.
    expect(document.querySelector('[data-tool-window="curvefit"]')).not.toBeNull();
    expect(toolDockSnapshot().owner).toBe("curvefit");
    expect(isToolMounted("curvefit")).toBe(false);
  });
});
