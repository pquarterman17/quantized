// Remember the last layout in the host (WORKSPACE_LAYOUT_PLAN P6): the layout
// host seeds a project without a layout from the per-user template, a tool the
// project never placed opens where the template keeps tools (a project's own
// placement wins), and Window ▸ Reset layout asks, then puts back the default
// seed for this width, keeping open windows open. Classic mode never offers it.
// Every assertion reads the store or the DOM, never a mock call count.

import { act, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { close, dock, emptyLayout, stackOf } from "../../../lib/windowLayout/ops";
import { WINDOW_LAYOUT_TEMPLATE_KEY, type WindowLayoutTemplateV1 } from "../../../lib/windowLayout/template";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { useCommands } from "../../../store/commands";
import { useConfirm } from "../../../store/confirmDialog";
import { announceWorkspaceReplace } from "../../../store/workspaceReplace";
import { isToolMounted, resetLayoutToolsForTests } from "../../../store/layoutTools";
import { resetToolDockForTests } from "../../../store/toolDock";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { RESET_LAYOUT_DONE, RESET_LAYOUT_TITLE } from "../../../store/windowLayoutReset";
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
const win = (id: string, z: number): PlotWindow => ({
  id, kind: "plot", title: `Graph ${id}`, datasetId: "d1", geometry: { x: 40, y: 40, w: 480, h: 360 }, z, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;
const TEMPLATE: WindowLayoutTemplateV1 = {
  v: 1,
  kinds: { plot: { slot: "centre", open: true }, data: { slot: "left", open: true }, style: { slot: "right", open: true }, tool: { slot: "left", open: true } },
  edges: { left: 300, right: 0, bottom: 0 },
  centre: "row",
};
const cmd = (id: string) => useCommands.getState().menuCommands.find((a) => a.id === id);

function seed(layout = dock(dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "left"), "data", "bottom")) {
  localStorage.clear();
  resetLayoutToolsForTests();
  resetToolDockForTests();
  useConfirm.getState().close();
  useApp.setState({
    datasets: [DATASET], activeId: "d1", selectedIds: ["d1"], plotWindows: [win("w1", 1)], focusedWindowId: "w1",
    layoutMode: "windows", windowLayout: { ...layout, edges: { left: 250, right: 0, bottom: 180 }, centre: "grid" }, leftCollapsed: false, status: "",
  });
}
const jsdomWidth = window.innerWidth;
beforeEach(() => {
  (window as { innerWidth: number }).innerWidth = 1440;
  seed();
});
afterEach(() => resetLayoutToolsForTests());
afterAll(() => void ((window as { innerWidth: number }).innerWidth = jsdomWidth));

function Workshop({ id = "peaks", title = "Curve Fit" }: { id?: string; title?: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <ToolWindow id={id} title={title} onClose={() => setOpen(false)}>body</ToolWindow>;
}
const mounted = async (id: string) => {
  await expect.poll(() => isToolMounted(id)).toBe(true);
  await expect.poll(() => s().windowLayout?.placements[`tool:${id}`]?.open).toBe(true);
};

describe("the template in the host", () => {
  it("a project with no layout is seeded from the template when the host mounts", async () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(TEMPLATE));
    useApp.setState({ windowLayout: null });
    render(<LayoutHost />);
    await expect.poll(() => s().windowLayout?.placements.data?.slot).toBe("left");
    expect(L().placements.data!.open).toBe(true);
    expect(L().placements["plot:w1"]).toMatchObject({ slot: "centre", open: true });
    expect(L().edges.left).toBe(300);
    expect(within(document.querySelector('[data-slot="left"]') as HTMLElement).getByRole("region", { name: /Data/ })).toBeTruthy();
    checkInvariants(L());
  });

  it("a tool the project never placed opens where the template keeps tools", async () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(TEMPLATE));
    render(<><LayoutHost /><Workshop /></>);
    await mounted("peaks");
    expect(L().placements["tool:peaks"]).toMatchObject({ slot: "left", open: true });
    checkInvariants(L());
  });

  it("a tool the project placed opens at the project's place, not the template's", async () => {
    seed(close(dock(dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), "tool:peaks", "bottom"), "tool:peaks"));
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(TEMPLATE));
    render(<><LayoutHost /><Workshop /></>);
    await mounted("peaks");
    expect(L().placements["tool:peaks"]).toMatchObject({ slot: "bottom", open: true });
  });
});

describe("Window ▸ Reset layout", () => {
  it("asks first; Cancel changes nothing", async () => {
    render(<LayoutHost />);
    const before = L();
    let done: Promise<unknown> = Promise.resolve();
    act(() => void (done = Promise.resolve(cmd("layout-reset")!.run())));
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    await act(async () => {
      useConfirm.getState().resolve?.(false);
      useConfirm.getState().close();
      await done;
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(L()).toBe(before);
  });

  it("confirmed: the default seed for this width; open windows stay open; the template follows", async () => {
    render(<><LayoutHost /><Workshop /></>);
    await mounted("peaks");
    const said = screen.getByTestId("wl-live").textContent; // the tool's own opening, before the reset
    act(() => void cmd("layout-reset")!.run());
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    await act(async () => {
      useConfirm.getState().resolve?.(true);
      useConfirm.getState().close();
    });
    await expect.poll(() => s().windowLayout?.placements.style?.slot).toBe("right");
    checkInvariants(L());
    expect(stackOf(L(), "right")).toEqual(["data", "style"]);
    expect(L().placements.data!.open).toBe(true);
    expect(stackOf(L(), "bottom")).toEqual(["tool:peaks"]);
    expect(L().edges).toEqual({ left: 0, right: 0, bottom: 0 });
    expect(L().centre).toBe("row");
    expect(s().status).toBe(RESET_LAYOUT_DONE);
    // Said once, by the status line (UX pass 5 m5): the layout's own region stays silent.
    expect(screen.getByTestId("wl-live").textContent).toBe(said);
    await expect.poll(() => JSON.parse(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY) ?? "null")?.wide?.kinds?.style?.slot).toBe("right");
    expect(JSON.parse(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY)!).wide.edges).toEqual({ left: 0, right: 0, bottom: 0 });
  });

  it("with no tool open, the reset forgets the template's old tool place: a tool then opens at the default bottom", async () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(TEMPLATE));
    const { rerender } = render(<LayoutHost />);
    act(() => void cmd("layout-reset")!.run());
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    await act(async () => {
      useConfirm.getState().resolve?.(true);
      useConfirm.getState().close();
    });
    await expect.poll(() => s().status).toBe(RESET_LAYOUT_DONE);
    expect(JSON.parse(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY)!).wide.kinds.tool).toBeUndefined();
    rerender(<><LayoutHost /><Workshop /></>);
    await mounted("peaks");
    expect(L().placements["tool:peaks"]).toMatchObject({ slot: "bottom", open: true });
  });

  it("a workspace replaced while the question is open is not reset (the user confirmed the old desk)", async () => {
    render(<LayoutHost />);
    let done: Promise<unknown> = Promise.resolve();
    act(() => void (done = Promise.resolve(cmd("layout-reset")!.run())));
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    const theirs = { ...dock(dock(emptyLayout(), "plot:w1", "left"), "style", "bottom"), edges: { left: 400, right: 0, bottom: 150 } };
    act(() => announceWorkspaceReplace());
    act(() => useApp.setState({ windowLayout: theirs }));
    await act(async () => {
      useConfirm.getState().resolve?.(true);
      useConfirm.getState().close();
      await done;
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(L().placements["plot:w1"]!.slot).toBe("left");
    expect(L().edges.left).toBe(400);
    expect(s().status).not.toBe(RESET_LAYOUT_DONE);
  });

  it("under 1280 px the reset is the floating seed (D6)", async () => {
    (window as { innerWidth: number }).innerWidth = 1100;
    render(<LayoutHost />);
    act(() => void cmd("layout-reset")!.run());
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    await act(async () => {
      useConfirm.getState().resolve?.(true);
      useConfirm.getState().close();
    });
    await expect.poll(() => s().windowLayout?.placements.style?.slot).toBeNull();
    for (const slot of ["left", "centre", "right", "bottom"] as const) expect(stackOf(L(), slot)).toEqual([]);
    expect(L().placements.data).toMatchObject({ open: true, slot: null });
  });

  it("is published only while the layout host is mounted (never in classic mode)", () => {
    expect(cmd("layout-reset")).toBeUndefined();
    const { unmount } = render(<LayoutHost />);
    expect(cmd("layout-reset")).toMatchObject({ group: "Window", label: "Reset layout…" });
    unmount();
    expect(cmd("layout-reset")).toBeUndefined();
  });
});
