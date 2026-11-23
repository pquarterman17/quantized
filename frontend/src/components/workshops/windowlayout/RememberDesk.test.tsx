// UX pass 5 (WORKSPACE_LAYOUT_PLAN P6 provisional decisions): M1 Reset puts a floated plot back at the
// centre; M2 a narrow session (or a tiled one) never overwrites the remembered desk, and the Reset
// question says so; m4 opening a project never makes it the template; m1 Cancel and Escape on the Reset
// question return focus to the focused plot's title bar; m5 the reset is announced once.
// Every assertion reads the store or the DOM, never a mock call count.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
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
import { RESET_LAYOUT_DONE, RESET_LAYOUT_MESSAGE, RESET_LAYOUT_MESSAGE_NARROW, RESET_LAYOUT_MESSAGE_TILED, RESET_LAYOUT_TITLE } from "../../../store/windowLayoutReset";
import ConfirmDialog from "../../overlays/ConfirmDialog";
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
    layoutMode: "windows", windowLayout: { ...layout, edges: { left: 250, right: 0, bottom: 180 }, centre: "grid" }, leftCollapsed: false, status: "", layoutTileBelow: 0,
  });
}
const jsdomWidth = window.innerWidth;
beforeEach(() => {
  (window as { innerWidth: number }).innerWidth = 1440;
  seed();
});
afterEach(() => resetLayoutToolsForTests());
afterAll(() => void ((window as { innerWidth: number }).innerWidth = jsdomWidth));

function Workshop({ id = "curvefit", title = "Curve Fit" }: { id?: string; title?: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <ToolWindow id={id} title={title} onClose={() => setOpen(false)}>body</ToolWindow>;
}
const mounted = async (id: string) => {
  await expect.poll(() => isToolMounted(id)).toBe(true);
  await expect.poll(() => s().windowLayout?.placements[`tool:${id}`]?.open).toBe(true);
};

const template = () => localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY);
/** The lazy template writer is a dynamic import: load it, then let a queued write run (it writes in a microtask). */
const settle = async () => {
  await import("../../../store/windowLayoutRun");
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
};
const width = (w: number) => void ((window as { innerWidth: number }).innerWidth = w);
const answer = async (ok: boolean) => {
  await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
  await act(async () => {
    useConfirm.getState().resolve?.(ok);
    useConfirm.getState().close();
  });
};
const reset = async (ok = true) => {
  act(() => void cmd("layout-reset")!.run());
  await answer(ok);
  await settle();
};
const click = (name: string) => act(() => void cmd(name)!.run());

describe("M1: Reset puts plot windows where a new project's go", () => {
  it("Float all, then Reset: the plot is at the centre and the template's plot is not float", async () => {
    render(<LayoutHost />);
    click("layout-float-all");
    expect(L().placements["plot:w1"]!.slot).toBeNull();
    await settle();
    await reset();
    expect(L().placements["plot:w1"]).toMatchObject({ slot: "centre", open: true });
    expect(L().z).not.toContain("plot:w1");
    checkInvariants(L());
    const t = JSON.parse(template()!) as WindowLayoutTemplateV1;
    expect(t.kinds.plot).toEqual({ slot: "centre", open: true });
  });
});

describe("M2: a narrow session never overwrites the remembered desk", () => {
  const WIDE = JSON.stringify(TEMPLATE);
  beforeEach(() => localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, WIDE));

  it("control: a user dock edit at 1440 px is remembered", async () => {
    render(<LayoutHost />);
    (await import("../../../store/windowLayoutActions")).dockRef("style", "bottom");
    await expect.poll(() => (JSON.parse(template()!) as WindowLayoutTemplateV1).kinds.style?.slot).toBe("bottom");
  });

  it("a tool that floats because the screen is narrow (D6) leaves the template unchanged", async () => {
    width(1024);
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    expect(L().placements["tool:curvefit"]).toMatchObject({ slot: null, open: true });
    await settle();
    expect(template()).toBe(WIDE);
  });

  it("a first-ever narrow session writes no template at all", async () => {
    localStorage.clear();
    width(1024);
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    await settle();
    expect(template()).toBeNull();
  });

  it("Float all at 1024 leaves the template unchanged", async () => {
    width(1024);
    render(<LayoutHost />);
    click("layout-float-all");
    expect(L().placements.style!.slot).toBeNull();
    await settle();
    expect(template()).toBe(WIDE);
  });

  it("Reset at 1100 tiled leaves the template unchanged, and the question says the remembered desk stays", async () => {
    width(1100);
    useApp.setState({ layoutTileBelow: 1200 });
    render(<LayoutHost />);
    expect(L().tiled).toBeDefined();
    act(() => void cmd("layout-reset")!.run());
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    expect(useConfirm.getState().message).toBe(RESET_LAYOUT_MESSAGE_NARROW);
    expect(useConfirm.getState().message).toMatch(/stays as it was/);
    await answer(true);
    await expect.poll(() => s().status).toBe(RESET_LAYOUT_DONE);
    await settle();
    expect(template()).toBe(WIDE);
  });

  it("Reset at 1100 (not tiled) leaves the template unchanged", async () => {
    width(1100);
    render(<LayoutHost />);
    await reset();
    expect(s().status).toBe(RESET_LAYOUT_DONE);
    expect(template()).toBe(WIDE);
  });

  it("Reset while tiled at a wide width leaves the template unchanged and says why", async () => {
    useApp.setState({ layoutTileBelow: 1500 }); // 1440 < 1500: the width rule tiles the desk
    render(<LayoutHost />);
    expect(L().tiled).toBeDefined();
    act(() => void cmd("layout-reset")!.run());
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    expect(useConfirm.getState().message).toBe(RESET_LAYOUT_MESSAGE_TILED);
    await answer(true);
    await expect.poll(() => s().status).toBe(RESET_LAYOUT_DONE);
    await settle();
    expect(template()).toBe(WIDE);
  });

  it("Reset on a wide, untiled desk still replaces the template, and its question promises that", async () => {
    render(<LayoutHost />);
    act(() => void cmd("layout-reset")!.run());
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    expect(useConfirm.getState().message).toBe(RESET_LAYOUT_MESSAGE);
    await answer(true);
    await expect.poll(() => template()).not.toBe(WIDE);
  });
});

describe("m4: opening a project never makes it the remembered desk", () => {
  it("a saved project's layout, restored with a plot window it lost, is reconciled but not remembered", async () => {
    const WIDE = JSON.stringify(TEMPLATE);
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, WIDE);
    render(<LayoutHost />);
    // What loadWorkspace does: a plain set of the project's own layout, which also names a window that is gone.
    const projectA = { ...dock(dock(dock(emptyLayout(), "plot:w1", "left"), "plot:gone", "centre"), "style", "bottom"), edges: { left: 111, right: 0, bottom: 99 } };
    act(() => announceWorkspaceReplace());
    act(() => useApp.setState({ windowLayout: projectA }));
    await expect.poll(() => L().placements["plot:gone"]).toBeUndefined(); // the host's reconcile ran
    expect(L().placements["plot:w1"]!.slot).toBe("left"); // the project's own place wins
    await settle();
    expect(template()).toBe(WIDE);
    // ...and the next user edit is remembered again.
    await import("../../../store/windowLayoutActions").then((m) => m.dockRef("style", "right"));
    await expect.poll(() => (JSON.parse(template()!) as WindowLayoutTemplateV1).kinds.style?.slot).toBe("right");
  });

  it("a tool opened in a project (first placement) is not remembered either", async () => {
    const WIDE = JSON.stringify(TEMPLATE);
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, WIDE);
    render(<><LayoutHost /><Workshop /></>);
    await mounted("curvefit");
    await settle();
    expect(template()).toBe(WIDE);
  });
});

describe("m1: Cancel and Escape on the Reset question return focus to the focused plot's title bar", () => {
  /** Render the host and lose focus to <body>, after the previous test's queued title-bar focus has landed. */
  const loseFocus = async () => {
    await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const onPlotTitle = () => {
    const el = document.activeElement as HTMLElement | null;
    return el !== document.body && el?.closest('[data-wl-window="plot:w1"]') !== null && el?.closest('[data-wl-window="plot:w1"]') !== undefined;
  };

  it("Cancel", async () => {
    render(<LayoutHost />);
    await loseFocus();
    await reset(false);
    await expect.poll(onPlotTitle).toBe(true);
  });

  it("Escape (the real dialog)", async () => {
    render(<><LayoutHost /><ConfirmDialog /></>);
    await loseFocus();
    act(() => void cmd("layout-reset")!.run());
    await expect.poll(() => screen.queryByRole("dialog", { name: RESET_LAYOUT_TITLE })).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await expect.poll(() => screen.queryByRole("dialog")).toBeNull();
    await expect.poll(onPlotTitle).toBe(true);
  });
});

describe("m5: the reset is announced once", () => {
  it("the status line says it; the layout's own live region stays silent (no second, different sentence)", async () => {
    render(<LayoutHost />);
    await reset();
    expect(s().status).toBe(RESET_LAYOUT_DONE);
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
    expect(screen.getByTestId("wl-live").textContent).toBe("");
  });
});
