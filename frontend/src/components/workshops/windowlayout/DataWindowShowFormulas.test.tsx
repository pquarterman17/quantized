// Show formulas (the palette command) in the default "Plot | Data side by side" layout: the Data window is the
// worksheet in view, though it is no plot window. Through the real LayoutHost, store and command registry.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildEditDataExtras } from "../../../commands/editDataExtras";
import { loadFormulaExtension } from "../../../lib/formulaExt";
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

const mk = (id: string, name: string): Dataset => ({
  id, name,
  data: { time: [0, 1, 2], values: [[3, 30], [1, 10], [2, 20]], labels: ["Temp", "Field"], units: ["K", "Oe"], metadata: {} },
});
const win: PlotWindow = {
  id: "w1", kind: "plot", title: "Plot", datasetId: "run", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
};
const s = () => useApp.getState();
const cell = (pos: number, col: number): HTMLElement | null => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`);
const run = () => buildEditDataExtras(() => useApp.getState()).find((a) => a.id === "show-formulas")!.run();

beforeEach(async () => {
  localStorage.clear();
  await loadFormulaExtension();
  (window as { innerWidth: number }).innerWidth = 1440;
  useApp.setState({
    datasets: [mk("run", "Run 1"), mk("other", "Other")],
    activeId: "run", selectedIds: ["run"], worksheetId: null, recalcMode: "auto", staleDatasets: [], history: [], future: [], namedRanges: [],
    plotWindows: [win], focusedWindowId: "w1", layoutMode: "windows", stageTab: "plot", status: "", worksheetSelections: {}, selection: null,
    windowLayout: dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), leftCollapsed: false, layoutTileBelow: 0,
  } as Partial<ReturnType<typeof useApp.getState>>);
  s().addFormula("run", "Sum", "Temp + Field");
  s().addFormula("other", "Sum", "Temp * Field");
});
afterEach(() => void ((window as { innerWidth: number }).innerWidth = 1024));

describe("Show formulas beside the plot", () => {
  it("toggles the Data window's formula text, and back, with no 'no worksheet in front' warning", async () => {
    render(<LayoutHost />);
    fireEvent.click(screen.getByRole("button", { name: "▥ Plot | Data side by side" }));
    await waitFor(() => expect(cell(0, 2)?.textContent).toBe("33.0000"));
    act(() => run());
    await waitFor(() => expect(cell(0, 2)?.textContent).toBe("A + B"));
    expect(s().status).not.toMatch(/No worksheet is in front/);
    act(() => run());
    await waitFor(() => expect(cell(0, 2)?.textContent).toBe("33.0000"));
  });

  it("works while the Data window is pinned to another sheet, and acts on that pane", async () => {
    render(<LayoutHost />);
    fireEvent.click(screen.getByRole("button", { name: "▥ Plot | Data side by side" }));
    act(() => pinDataWindow("other"));
    await waitFor(() => expect(cell(0, 2)?.textContent).toBe("90.0000")); // Temp * Field = 3 * 30
    act(() => run());
    await waitFor(() => expect(cell(0, 2)?.textContent).toBe("A * B"));
  });

  it("with the Data window closed it still says no worksheet is in front", () => {
    render(<LayoutHost />);
    act(() => run());
    expect(s().status).toMatch(/No worksheet is in front/);
  });
});
