// C12 (acceptance pass 5): a bare "show the worksheet" request (View > Worksheet, the
// Mirror column… and Set column values… commands) while the Data window already shows
// that sheet raises the Data window; it never adds a second window ("sheetB.csv (2)")
// onto the same sheet. "Plot | Data side by side" applied twice leaves one Data window.
// Through the real store and the real LayoutHost.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { useApp } from "../../../store/useApp";
import { pinDataWindow } from "../../../store/windowLayoutActions";
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

beforeEach(async () => {
  localStorage.clear();
  (window as { innerWidth: number }).innerWidth = 1440;
  useApp.setState({
    datasets: [mk("src", "Run 2", [[10, 1], [20, 2], [30, 3]], ["T", "R"]), mk("mir", "Summary", [[100], [200], [300]], ["Q"])],
    activeId: "mir", selectedIds: ["mir"], worksheetId: null, recalcMode: "auto", staleDatasets: [], history: [], future: [],
    plotWindows: [win({})], focusedWindowId: "w1", layoutMode: "windows", stageTab: "plot", status: "", worksheetSelections: {}, selection: null,
    windowLayout: dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), leftCollapsed: false, layoutTileBelow: 0,
  } as Partial<ReturnType<typeof useApp.getState>>);
});
afterEach(() => void ((window as { innerWidth: number }).innerWidth = 1024));


const dataRegions = () => document.querySelectorAll('[data-wl-window="data"]');
const plotData = () => fireEvent.click(screen.getByRole("button", { name: "▥ Plot | Data side by side" }));
const wsWindows = () => s().plotWindows.filter((w) => w.kind === "worksheet");

describe("one window per sheet in the window layout", () => {
  it("applying Plot | Data side by side twice leaves exactly one Data window and no worksheet window", async () => {
    render(<LayoutHost />);
    plotData();
    plotData();
    await waitFor(() => expect(dataRegions()).toHaveLength(1));
    expect(wsWindows()).toHaveLength(0);
  });

  it("a Worksheet request on the sheet the Data window shows raises Data, never a second window", async () => {
    render(<LayoutHost />);
    plotData();
    act(() => s().setStageTab("worksheet")); // what Mirror column… and Set column values… file
    await waitFor(() => expect(s().stageTab).toBe("plot")); // the adapter consumed it
    expect(wsWindows()).toHaveLength(0);
    expect(dataRegions()).toHaveLength(1);
    expect(s().windowLayout?.placements.data?.open).toBe(true);
  });

  it("a Data window pinned to ANOTHER sheet still gets the worksheet its own window (fail closed)", async () => {
    render(<LayoutHost />);
    plotData();
    act(() => pinDataWindow("src"));
    act(() => s().setStageTab("worksheet")); // the active sheet is "mir", which Data no longer shows
    await waitFor(() => expect(wsWindows().map((w) => w.datasetId)).toEqual(["mir"]));
    expect(dataRegions()).toHaveLength(1);
  });

  it("a closed Data window does not count as showing the sheet", async () => {
    render(<LayoutHost />);
    act(() => s().setStageTab("worksheet"));
    await waitFor(() => expect(wsWindows().map((w) => w.datasetId)).toEqual(["mir"]));
  });
});
