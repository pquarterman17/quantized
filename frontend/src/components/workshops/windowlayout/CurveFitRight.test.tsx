// OG15 (owner decision 2026-11-27, PROVISIONAL): Curve Fit docks in the RIGHT column, stacked after
// Style, so the plot keeps its full height. Through the real mount path (ToolWindow -> registry ->
// ToolWindowsSync -> openToolPlacement) and the real Dock all / Reset layout commands. Assertions
// read the store. A placement already saved keeps its slot (no migration).

import { act, render } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { dock, emptyLayout, stackOf } from "../../../lib/windowLayout/ops";
import { CURVEFIT_SHARE } from "../../../lib/windowLayout/shares";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { useCommands } from "../../../store/commands";
import { useConfirm } from "../../../store/confirmDialog";
import { isToolMounted, resetLayoutToolsForTests } from "../../../store/layoutTools";
import { resetToolDockForTests } from "../../../store/toolDock";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { RESET_LAYOUT_TITLE } from "../../../store/windowLayoutReset";
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

beforeAll(() => vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} }));
afterAll(() => vi.unstubAllGlobals());

const DATASET: Dataset = { id: "d1", name: "ds1", data: { time: [0, 1], values: [[1], [2]], labels: ["a"], units: [""], metadata: {} } };
const win = (): PlotWindow => ({
  id: "w1", kind: "plot", title: "Graph w1", datasetId: "d1", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;
const CF = "tool:curvefit" as const;
const cmd = (id: string) => useCommands.getState().menuCommands.find((a) => a.id === id);

const base = () => dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right");
function seed(layout = base()) {
  localStorage.clear();
  resetLayoutToolsForTests();
  resetToolDockForTests();
  useConfirm.getState().close();
  useApp.setState({ datasets: [DATASET], activeId: "d1", selectedIds: ["d1"], plotWindows: [win()], focusedWindowId: "w1", layoutMode: "windows", windowLayout: layout, leftCollapsed: false, status: "" });
}
const jsdomWidth = window.innerWidth;
beforeEach(() => {
  (window as { innerWidth: number }).innerWidth = 1440;
  seed();
});
afterEach(() => resetLayoutToolsForTests());
afterAll(() => void ((window as { innerWidth: number }).innerWidth = jsdomWidth));

function Workshop({ id }: { id: string }) {
  const [open, setOpen] = useState(true);
  return open ? <ToolWindow id={id} title={id} onClose={() => setOpen(false)}>body</ToolWindow> : null;
}
const mounted = async (id: string) => {
  await expect.poll(() => isToolMounted(id)).toBe(true);
  await expect.poll(() => s().windowLayout?.placements[`tool:${id}`]?.open).toBe(true);
};

describe("OG15: Curve Fit docks right, after Style", () => {
  it("opening Curve Fit fresh lands it in the right column after Style, with the larger share; the bottom stays free", async () => {
    render(<><LayoutHost /><Workshop id="curvefit" /></>);
    await mounted("curvefit");
    expect(stackOf(L(), "right")).toEqual(["style", CF]);
    expect(stackOf(L(), "bottom")).toEqual([]);
    expect(L().placements[CF]!.share).toBeCloseTo(CURVEFIT_SHARE, 9);
    expect(L().placements.style!.share).toBeCloseTo(1 - CURVEFIT_SHARE, 9);
    checkInvariants(L());
  });

  it("every other tool still opens at the bottom", async () => {
    render(<><LayoutHost /><Workshop id="peaks" /></>);
    await mounted("peaks");
    expect(stackOf(L(), "bottom")).toEqual(["tool:peaks"]);
    expect(stackOf(L(), "right")).toEqual(["style"]);
  });

  it("a saved Curve Fit placement keeps its slot: no migration", async () => {
    const saved = dock(base(), CF, "bottom");
    seed({ ...saved, placements: { ...saved.placements, [CF]: { ...saved.placements[CF]!, open: false } } });
    render(<><LayoutHost /><Workshop id="curvefit" /></>);
    await mounted("curvefit");
    expect(stackOf(L(), "bottom")).toEqual([CF]);
    expect(stackOf(L(), "right")).toEqual(["style"]);
  });

  it("Dock all sends an open Curve Fit to the right stack after Style, other tools to the bottom", async () => {
    seed(dock(dock(base(), "tool:peaks", "left"), CF, "left"));
    render(<><LayoutHost /><Workshop id="curvefit" /><Workshop id="peaks" /></>);
    await mounted("curvefit");
    await mounted("peaks");
    act(() => void cmd("layout-dock-all")!.run());
    expect(stackOf(L(), "right")).toEqual(["style", CF]);
    expect(stackOf(L(), "bottom")).toEqual(["tool:peaks"]);
    expect(L().placements[CF]!.share).toBeCloseTo(CURVEFIT_SHARE, 9);
    checkInvariants(L());
  });

  it("Reset layout puts an open Curve Fit on the right, not at the bottom", async () => {
    seed(dock(base(), CF, "left"));
    render(<><LayoutHost /><Workshop id="curvefit" /></>);
    await mounted("curvefit");
    act(() => void cmd("layout-reset")!.run());
    await expect.poll(() => useConfirm.getState().title).toBe(RESET_LAYOUT_TITLE);
    await act(async () => {
      useConfirm.getState().resolve?.(true);
      useConfirm.getState().close();
    });
    await expect.poll(() => stackOf(L(), "right").includes(CF)).toBe(true);
    expect(stackOf(L(), "right")).toEqual(["style", CF]);
    expect(stackOf(L(), "bottom")).toEqual([]);
  });
});
