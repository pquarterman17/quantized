// Go to Source on a mirror column, in BOTH layouts, through the real store and
// the real LayoutHost: in the window layout the source's worksheet WINDOW opens
// (or is raised) and the column is selected there, never in the Stage tab; Find
// in project's cell reveal names the window the same way.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadFormulaExtension } from "../../../lib/formulaExt";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { useApp } from "../../../store/useApp";
import { createMirror, goToMirrorSource } from "../../../store/mirrorColumn";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
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

const mk = (id: string, name: string, rows: number[][], labels: string[]): Dataset => ({
  id, name,
  data: { time: rows.map((_, i) => i), values: rows, labels, units: labels.map(() => ""), metadata: {} },
});
const win = (over: Partial<PlotWindow>): PlotWindow => ({
  id: "w1", kind: "plot", title: "Summary plot", datasetId: "mir", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
});
const s = () => useApp.getState();
const sheets = (id: string) => s().plotWindows.filter((w) => w.kind === "worksheet" && w.datasetId === id);

beforeEach(async () => {
  await loadFormulaExtension();
  localStorage.clear();
  (window as { innerWidth: number }).innerWidth = 1440;
  useWorksheetReveal.setState({ rowReveal: null });
  useApp.setState({
    datasets: [mk("src", "Run 2", [[10, 1], [20, 2], [30, 3]], ["T", "R"]), mk("mir", "Summary", [[100], [200], [300]], ["Q"])],
    activeId: "mir", selectedIds: ["mir"], worksheetId: null, recalcMode: "auto", staleDatasets: [], history: [], future: [],
    plotWindows: [win({})], focusedWindowId: "w1", layoutMode: "windows", stageTab: "plot", status: "", worksheetSelections: {}, selection: null,
    windowLayout: dock(dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), "data", "right"), leftCollapsed: false, layoutTileBelow: 0,
  } as Partial<ReturnType<typeof useApp.getState>>);
});
afterEach(() => void ((window as { innerWidth: number }).innerWidth = 1024));

describe("Go to Source in the window layout", () => {
  it("opens the source's worksheet window and selects the column there", async () => {
    createMirror("mir", "src", 1);
    render(<LayoutHost />);
    act(() => goToMirrorSource("mir", 0));
    await waitFor(() => expect(sheets("src")).toHaveLength(1));
    const frame = await screen.findByRole("region", { name: "Run 2" });
    const grid = await within(frame).findByRole("grid");
    expect(grid).toBeTruthy();
    await waitFor(() => expect(useWorksheetReveal.getState().rowReveal).toBeNull()); // the window's pane consumed it
    const headers = frame.querySelectorAll<HTMLElement>("[role=columnheader]");
    const selected = [...headers].filter((h) => h.style.borderBottomWidth === "2px").map((h) => h.getAttribute("data-col"));
    expect(selected).toEqual(["1"]); // column B (index 1) of the source
    expect(s().stageTab).toBe("plot"); // not the Stage tab
    expect(s().activeId).toBe("mir"); // a plain open: the plot and its tools keep their input
  });

  it("raises the source's existing window instead of opening a second", async () => {
    createMirror("mir", "src", 0);
    render(<LayoutHost />);
    act(() => goToMirrorSource("mir", 0));
    await waitFor(() => expect(sheets("src")).toHaveLength(1));
    act(() => goToMirrorSource("mir", 0, 1));
    await waitFor(() => expect(useWorksheetReveal.getState().rowReveal).toBeNull());
    expect(sheets("src")).toHaveLength(1);
  });
});

describe("Go to Source in the classic layout", () => {
  it("shows the source in the Worksheet tab and files a request for no window", async () => {
    createMirror("mir", "src", 1);
    useApp.setState({ layoutMode: "classic" } as Partial<ReturnType<typeof useApp.getState>>);
    goToMirrorSource("mir", 0);
    expect(s().worksheetId).toBe("src");
    expect(s().stageTab).toBe("worksheet");
    expect(useWorksheetReveal.getState().rowReveal?.windowId).toBeUndefined();
    expect(sheets("src")).toHaveLength(0);
  });
});
