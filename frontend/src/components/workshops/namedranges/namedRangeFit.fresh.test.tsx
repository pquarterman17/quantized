// A fit run from "Input from named range" is fresh when it lands (acceptance pass 11 W2, #1195): not "Inputs
// changed - refit", not "Out of date". A real change to the range afterwards still marks it, and a refit clears it.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { layoutTool, resetLayoutToolsForTests } from "../../../store/layoutTools";
import { resetToolDockForTests } from "../../../store/toolDock";
import LayoutHost from "../windowlayout/LayoutHost";
import { listFitModels } from "../../../lib/api/curvefit";
import type { Dataset } from "../../../lib/types";
import { retargetNamedRange } from "../../../store/namedRanges";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "../curvefit/CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../windows/BackgroundPlotWindow", () => ({ default: ({ windowId }: { windowId: string }) => <div data-testid={`bg-${windowId}`} /> }));
vi.mock("../../Inspector/Inspector", () => ({ default: () => <aside className="qzk-inspector" /> }));
vi.mock("../../windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("../../history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));
vi.mock("../../../commands/recentProjectsCommands", () => ({ useRecentProjectsCommands: () => {} }));
vi.mock("../../../commands/relinkCommands", () => ({ useRelinkCommands: () => {} }));
vi.mock("../../../commands/workbookTransferCommands", () => ({ useWorkbookTransferCommands: () => {} }));
vi.mock("../../../commands/projectLockCommands", () => ({ useProjectLockCommands: () => {} }));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
const win: PlotWindow = {
  id: "w1", kind: "plot", title: "Graph w1", datasetId: "d", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
};

// st48.csv's shape: a time column t = 1..48 and three channels; no excluded rows.
const N = 48;
const ds: Dataset = {
  id: "d", name: "st48.csv",
  data: {
    time: Array.from({ length: N }, (_v, i) => i + 1),
    values: Array.from({ length: N }, (_v, i) => [0.5 + 0.005 * i + 0.01 * ((i * 7) % 5), 2 + 0.02 * i, 10 - ((i * 3) % 7)]),
    labels: ["s1", "s2", "s3"], units: ["", "", ""], metadata: {},
  },
};

const stale = () => [...screen.queryAllByText(/Inputs changed|Out of date/)];
const fit = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Fit" })));

describe("a fit run from a named range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    resetLayoutToolsForTests();
    resetToolDockForTests();
    useAnalysisSelection.getState().clear();
    vi.mocked(listFitModels).mockResolvedValue({
      models: [{ name: "Linear", category: "Linear", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
    });
    vi.mocked(fitModel).mockImplementation(async (req) => ({
      params: [0.005, 0.63], errors: [0.1, 0.1], R2: 0.99, chiSqRed: 1, nPoints: req.x.length, nFree: 2,
      yFit: req.x.map((v) => 0.005 * v + 0.63), residuals: req.x.map(() => 0),
    }) as Awaited<ReturnType<typeof fitModel>>);
    useApp.setState({
      plotWindows: [win], focusedWindowId: "w1", layoutMode: "windows", windowLayout: dock(emptyLayout(), "plot:w1", "centre"), leftCollapsed: false,
      datasets: [ds], activeId: "d", selectedIds: ["d"], xKey: null, yKeys: [0, 1, 2], seriesOrder: null, errKeys: {}, fitOverlay: null, curveFitOpen: true,
      qfitRoi: null, integral: null, selection: null,
      namedRanges: [{ id: "nr1:w", name: "Win", scope: { kind: "sheet", datasetId: "d" }, target: { datasetId: "d", cols: [0], rows: { from: 4, to: 11 } } }],
    });
  });

  it("is fresh after the first Fit, keeps the range's columns, and a later change to the range marks it", async () => {
    // The tool window pins its input while a run is in flight and releases it after; that release must give the
    // chosen input back, not re-capture the plotted columns (the plot shows all three channels here).
    const { rerender } = render(<LayoutHost />);
    await screen.findByTestId("plot-stage");
    rerender(<><LayoutHost /><CurveFitPanel /></>);
    await screen.findAllByRole("option", { name: "Linear" });
    fireEvent.change(screen.getAllByRole("combobox", { name: "Input from named range" })[0], { target: { value: "nr1:w" } });
    await fit();
    expect(vi.mocked(fitModel).mock.calls.at(-1)![0].x).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    await waitFor(() => expect(layoutTool("curvefit")?.autoPin).toBeNull());
    await screen.findAllByText(/Linear fit|R²/);
    const held = useAnalysisSelection.getState();
    expect(held.selection?.source).toBe("worksheet");
    expect(held.selection?.items[0]).toMatchObject({ yKeys: [0], rowRange: { from: 4, to: 11, named: "nr1:w" } });
    expect(stale()).toHaveLength(0);
    act(() => void retargetNamedRange("nr1:w", { datasetId: "d", cols: [0], rows: { from: 5, to: 14 } }));
    expect((await screen.findAllByText(/Inputs changed|Out of date/)).length).toBeGreaterThan(0);
    await fit();
    await waitFor(() => expect(layoutTool("curvefit")?.autoPin).toBeNull());
    expect(stale()).toHaveLength(0);
  });
});
