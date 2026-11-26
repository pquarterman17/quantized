// The one worksheet-open intent (store/worksheetOpen.ts) in the window layout and
// in classic. Everything goes through the real store and the real LayoutHost: New
// Workbook, an analysis output opened as a worksheet and Go to Source rows all
// land on a visible worksheet window, never on the "not in the window layout yet"
// notice, and none of them retargets the plot or a tool that follows it.

import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { analysisTargetDataset } from "../../../lib/analysisInputs";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { openAnalysisSourceRows } from "../../../store/analysisResultRowNavigation";
import { newWorkbook } from "../../../store/newWorkbook";
import { useApp } from "../../../store/useApp";
import { pinDataWindow } from "../../../store/windowLayoutActions";
import { openWorksheet, STAGE_WORKSHEET_SELECTION_KEY } from "../../../store/worksheetOpen";
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
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});
afterAll(() => vi.unstubAllGlobals());

const mk = (id: string, name: string, n = 4): Dataset => ({
  id, name,
  data: { time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [i * 2]), labels: ["y"], units: [""], metadata: {} },
});
const win = (over: Partial<PlotWindow>): PlotWindow => ({
  id: "w1", kind: "plot", title: "Source plot", datasetId: "src", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
});
const s = () => useApp.getState();
const sheets = (id?: string) => s().plotWindows.filter((w) => w.kind === "worksheet" && (id === undefined || w.datasetId === id));

beforeEach(() => {
  localStorage.clear();
  (window as { innerWidth: number }).innerWidth = 1440;
  useApp.setState({
    datasets: [mk("src", "groups.csv"), mk("out", "Fit Y by X summary", 2)], activeId: "src", selectedIds: ["src"], worksheetId: null,
    plotWindows: [win({})], focusedWindowId: "w1", layoutMode: "windows", stageTab: "plot", status: "", worksheetSelections: {}, selection: null,
    windowLayout: dock(dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), "data", "right"), leftCollapsed: false, layoutTileBelow: 0,
  } as Partial<ReturnType<typeof useApp.getState>>);
});
afterEach(() => void ((window as { innerWidth: number }).innerWidth = 1024));

describe("window layout: one worksheet-open intent", () => {
  it("opening an analysis output shows its sheet and leaves the plot and the tool input alone", async () => {
    const tool = renderHook(() => useApp((st) => analysisTargetDataset(st.datasets, st.activeId, null, true)?.id));
    render(<LayoutHost />);
    act(() => openWorksheet({ datasetId: "out" }));
    await waitFor(() => expect(sheets("out")).toHaveLength(1));
    const frame = await screen.findByRole("region", { name: "Fit Y by X summary" });
    expect(await within(frame).findByRole("grid")).toBeTruthy();
    expect(screen.queryByText(/not in the window layout yet/)).toBeNull();
    expect(s().layoutMode).toBe("windows");
    // The source plot and the input of a tool that follows the active dataset are unchanged.
    expect(s().activeId).toBe("src");
    expect(s().focusedWindowId).toBe("w1");
    expect(s().plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("src");
    expect(tool.result.current).toBe("src");
    expect(s().stageTab).toBe("plot");
  });

  it("New Workbook opens its sheet in a window, with a keyboard-reachable grid", async () => {
    render(<LayoutHost />);
    let id = "";
    act(() => void (id = newWorkbook()));
    await waitFor(() => expect(sheets(id)).toHaveLength(1));
    expect(screen.queryByText(/not in the window layout yet/)).toBeNull();
    const frame = await screen.findByRole("region", { name: "Book1" });
    const grid = await within(frame).findByRole("grid");
    expect(grid.getAttribute("tabindex")).toBe("0"); // Tab from the title bar enters the cells
    // The empty book is not plotted: the source plot and the active dataset (every tool's input) stay.
    expect(s().activeId).toBe("src");
    expect(s().plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("src");
  });

  it("opening the same sheet again brings its window forward instead of making a second", async () => {
    render(<LayoutHost />);
    act(() => openWorksheet({ datasetId: "out" }));
    await waitFor(() => expect(sheets("out")).toHaveLength(1));
    const z0 = sheets("out")[0].z;
    act(() => s().raiseWindow("w1"));
    act(() => openWorksheet({ datasetId: "out" }));
    expect(sheets("out")).toHaveLength(1);
    expect(sheets("out")[0].z).toBeGreaterThan(z0);
  });

  it("Go to Source selects the rows in the sheet window and on the linked plot selection", async () => {
    render(<LayoutHost />);
    act(() => openAnalysisSourceRows("src", [1, 3]));
    await waitFor(() => expect(sheets("src")).toHaveLength(1));
    expect(s().worksheetSelections[sheets("src")[0].id]).toEqual({ datasetId: "src", rows: [1, 3] });
    expect(s().selection?.rows).toEqual([1, 3]);
    expect(s().activeId).toBe("src");
  });

  it("a Data window pinned to another sheet stays pinned; the new sheet gets a window beside it", async () => {
    render(<LayoutHost />);
    act(() => pinDataWindow("src"));
    act(() => openWorksheet({ datasetId: "out" }));
    await waitFor(() => expect(sheets("out")).toHaveLength(1));
    expect(s().windowLayout?.data?.pinned).toBe("src");
    expect(s().windowLayout?.placements.data?.open).toBe(true);
    expect(within(screen.getByTestId("data-source")).getByText("groups.csv")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Fit Y by X summary" })).toBeTruthy();
  });

  it("an unknown dataset opens nothing", () => {
    render(<LayoutHost />);
    act(() => openWorksheet({ datasetId: "nope" }));
    expect(sheets()).toHaveLength(0);
  });
});

describe("classic layout: the same intent", () => {
  beforeEach(() => useApp.setState({ layoutMode: "classic", windowLayout: null } as Partial<ReturnType<typeof useApp.getState>>));

  it("shows the sheet in the Worksheet tab through the override and keeps the active dataset", () => {
    openWorksheet({ datasetId: "out" });
    expect(s().stageTab).toBe("worksheet");
    expect(s().worksheetId).toBe("out");
    expect(s().activeId).toBe("src");
  });

  it("selects the supplied rows under the Worksheet tab's own key for a non-active sheet", () => {
    openWorksheet({ datasetId: "out", rowIds: [0, 1] });
    expect(s().worksheetSelections[STAGE_WORKSHEET_SELECTION_KEY]).toEqual({ datasetId: "out", rows: [0, 1] });
  });

  it("uses the plot's own selection when the sheet is the plotted data", () => {
    openAnalysisSourceRows("src", [2]);
    expect(s().selection?.rows).toEqual([2]);
    expect(s().stageTab).toBe("worksheet");
  });
});
