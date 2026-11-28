// The LIVE link from a plot and a fit to a named range (ROW_RANGE_CONTRACT 5.2, `PlotView.rowRange = { named: id }`),
// driven from the Named Ranges manager, the analysis input picker and Curve Fit, through the real stores and the real
// plot payload. The first user of the contract: Plot from the manager, retarget the range and the plot follows, delete it
// and the plot refuses with its reason (never every row), undo and the link is back.
//
// Every number is checked against numpy (the least-squares constants below were computed with np.polyfit on exactly
// those rows), and every drawn row is a SOURCE row.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import { savedInputRowsLine } from "../../../lib/inputRowRange";
import { loadFormulaExtension } from "../../../lib/formulaExt";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useConfirm } from "../../../store/confirmDialog";
import { retargetNamedRange } from "../../../store/namedRanges";
import { resetRangeLinkSyncForTests } from "../../../store/rangeLinkSync";
import { markRowsReplaced } from "../../../store/rowRangeShift";
import { snapshotSaveRange } from "../../../store/savedRowRange";
import { useApp } from "../../../store/useApp";
import PlotRowRangeChip from "../../Stage/PlotRowRangeChip";
import { usePlotPayload, type PlotPayloadParams } from "../../Stage/usePlotPayload";
import CurveFitPanel from "../curvefit/CurveFitPanel";
import { closeNamedRangesManager, openNamedRangesManager } from "./openManager";

vi.mock("../../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/plotdata")>();
  return {
    ...actual,
    fetchPlot: async (ds: Parameters<typeof actual.buildColumns>[0], _yLog: boolean, _xLog: boolean, yKeys: number[] | null, y2Keys: number[] | null, xKey: number | null) =>
      actual.buildColumns(ds, y2Keys, xKey, yKeys),
  };
});
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));

// y = 3 x + 7 + a fixed integer wobble ((7 i mod 5) - 2), x = the row number.
const N = 60;
const ds: Dataset = {
  id: "d",
  name: "run.csv",
  data: {
    time: Array.from({ length: N }, (_v, i) => i),
    values: Array.from({ length: N }, (_v, i) => [3 * i + 7 + ((i * 7) % 5) - 2, 200 + i]),
    labels: ["Y", "B"], units: ["", ""], metadata: {},
  },
  excludedRows: [25],
};
const window2144 = { from: 20, to: 43 };
// np.polyfit(x[rows], y[rows], 1) over rows 21-44 less the excluded row 26 (23 rows), and over rows 6-15 (10 rows).
const NUMPY_21_44 = { m: 2.9992923415631396, b: 7.065969492058432, n: 23 };
const NUMPY_6_15 = { m: 3.1212121212121198, b: 5.848484848484837, n: 10 };

const st = () => useApp.getState();
const drawn = (x: unknown) => (x as (number | null)[]).flatMap((v, r) => (v == null ? [] : [r]));
const rowsOf = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_v, i) => from + i);

/** The rows the plot draws NOW, through the real payload hook. */
async function drawnRows(): Promise<number[]> {
  const s = st();
  const params: PlotPayloadParams = {
    active: s.datasets.find((d) => d.id === s.activeId)!, yScale: "linear", xScale: "linear", xKey: s.xKey, yKeys: s.yKeys, groupKey: null, y2Keys: null, seriesOrder: null,
    seriesStyles: {}, seriesLabels: {}, errKeys: {}, hiddenChannels: [], waterfall: 0, excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null, xLim: null, rowRange: s.rowRange,
  };
  const { result } = renderHook(() => usePlotPayload(params));
  await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
  return drawn(result.current.displayPayload!.data[1]);
}

const managerRow = () => screen.getByRole("row", { name: /Window/ });
const openManager = () => {
  act(() => openNamedRangesManager());
  return managerRow();
};

beforeEach(async () => {
  await loadFormulaExtension();
  resetRangeLinkSyncForTests();
  useApp.setState({
    datasets: [ds], workbooks: [], activeId: "other", selectedIds: [], xKey: null, yKeys: null, rowRange: undefined, plotWindows: [], focusedWindowId: null,
    namedRanges: [{ id: "nr1:w", name: "Window", scope: { kind: "sheet", datasetId: "d" }, target: { datasetId: "d", cols: [1], rows: window2144 } }],
    stageTab: "worksheet", history: [], future: [], status: "", staleDatasets: [],
  });
  useAnalysisSelection.setState({ toolId: null, selection: null, offeredRanges: {} });
  useConfirm.getState().close();
});
afterEach(() => closeNamedRangesManager());

describe("Plot from the manager follows its named range", () => {
  it("Plot links the window; a retarget moves it; deleting the range refuses with the reason; undo brings the link back", async () => {
    fireEvent.click(within(openManager()).getByRole("button", { name: "Plot" }));
    expect(st().rowRange).toEqual({ ...window2144, named: "nr1:w", namedAs: "Window" });
    // Rows 21-44 draw, less the excluded row 26 (still applied inside the window).
    expect(await drawnRows()).toEqual(rowsOf(20, 43).filter((r) => r !== 25));

    // Retarget through the manager's own editor: rows 6-15.
    fireEvent.click(within(managerRow()).getByRole("button", { name: "Retarget…" }));
    fireEvent.change(screen.getByLabelText("First row"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Last row"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Retarget" }));
    expect(st().namedRanges[0].target.rows).toEqual({ from: 5, to: 14 });
    expect(st().rowRange).toEqual({ from: 5, to: 14, named: "nr1:w", namedAs: "Window" }); // the plot followed
    expect(await drawnRows()).toEqual(rowsOf(5, 14));

    // Delete: the dialog lists the plot, a confirmed delete refuses the link, and the plot draws NO rows.
    fireEvent.click(within(managerRow()).getByRole("button", { name: "Delete" }));
    await screen.findByText("Delete");
    const ask = useConfirm.getState();
    expect(ask.message).toMatch(/1 thing uses it:\nplot: the plot of run\.csv/);
    expect(st().namedRanges).toHaveLength(1); // nothing changed before the confirm
    await act(async () => ask.resolve?.(true));
    expect(st().namedRanges).toEqual([]);
    expect(st().rowRange).toMatchObject({ named: "nr1:w", refused: "the named range was removed" });
    expect(await drawnRows()).toEqual([]); // never widened to every row
    const chip = render(<PlotRowRangeChip />);
    expect(chip.container).toHaveTextContent("Window: no rows");
    expect(chip.container.querySelector("[title]")?.getAttribute("title")).toMatch(/the named range was removed.*draws no rows/);

    // One undo: the range, and the link with the rows it covered.
    act(() => st().undo());
    expect(st().namedRanges).toHaveLength(1);
    expect(st().rowRange).toEqual({ from: 5, to: 14, named: "nr1:w", namedAs: "Window" });
    expect(await drawnRows()).toEqual(rowsOf(5, 14));
  });

  it("a row insert above the window and a delete inside it move the link with the range, in the edit's own undo step", () => {
    fireEvent.click(within(openManager()).getByRole("button", { name: "Plot" }));
    act(() => st().insertRows("d", 0, 2));
    expect(st().namedRanges[0].target.rows).toEqual({ from: 22, to: 45 });
    expect(st().rowRange).toMatchObject({ from: 22, to: 45, named: "nr1:w" });
    act(() => st().deleteRows("d", [30, 31]));
    expect(st().rowRange).toMatchObject({ from: 22, to: 43, named: "nr1:w" });
    act(() => st().undo());
    expect(st().rowRange).toMatchObject({ from: 22, to: 45 });
    act(() => st().undo());
    expect(st().rowRange).toMatchObject({ from: 20, to: 43 });
  });

  it("a worksheet whose rows were replaced refuses the link with the model's reason; retargeting keeps the rows and the link reads again", async () => {
    fireEvent.click(within(openManager()).getByRole("button", { name: "Plot" }));
    act(() => markRowsReplaced("d", true));
    expect(st().rowRange).toMatchObject({ named: "nr1:w", refused: expect.stringMatching(/rows were replaced/) });
    expect(await drawnRows()).toEqual([]);
    fireEvent.click(within(managerRow()).getByRole("button", { name: "Retarget…" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Retarget" })[0]);
    expect(st().rowRange).toEqual({ ...window2144, named: "nr1:w", namedAs: "Window" });
  });

  it("clearing the chip drops the link: later retargets leave the plot alone", () => {
    fireEvent.click(within(openManager()).getByRole("button", { name: "Plot" }));
    const chip = render(<PlotRowRangeChip />);
    fireEvent.click(within(chip.container).getByRole("button", { name: "Clear plot row range" }));
    expect(st().rowRange).toBeUndefined();
    act(() => void retargetNamedRange("nr1:w", { datasetId: "d", cols: [1], rows: { from: 1, to: 3 } }));
    expect(st().rowRange).toBeUndefined();
  });
});

describe("a fit run from a named range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listFitModels).mockResolvedValue({
      models: [{ name: "Linear", category: "Linear", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
    });
    // The backend stand-in is an exact least-squares line through whatever rows the fit sent.
    vi.mocked(fitModel).mockImplementation(async (req) => {
      const [m, b] = lsq(req);
      return { params: [m, b], errors: [0.1, 0.1], R2: 0.99, chiSqRed: 1, nPoints: req.x.length, nFree: 2, yFit: req.x.map((v) => m * v + b), residuals: req.x.map((v, i) => req.y[i] - (m * v + b)) } as Awaited<ReturnType<typeof fitModel>>;
    });
    useApp.setState({ activeId: "d", selectedIds: ["d"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, fitOverlay: null, curveFitOpen: true, qfitRoi: null, integral: null, selection: null,
      namedRanges: [{ id: "nr1:w", name: "Window", scope: { kind: "sheet", datasetId: "d" }, target: { datasetId: "d", cols: [0], rows: window2144 } }] });
  });

  const lsq = (req: { x: number[]; y: number[] }): [number, number] => {
    const n = req.x.length, mx = req.x.reduce((a, v) => a + v, 0) / n, my = req.y.reduce((a, v) => a + v, 0) / n;
    const m = req.x.reduce((a, v, i) => a + (v - mx) * (req.y[i] - my), 0) / req.x.reduce((a, v) => a + (v - mx) ** 2, 0);
    return [m, my - m * mx];
  };
  const fit = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Fit" })));
  const sent = () => vi.mocked(fitModel).mock.calls.at(-1)![0];

  it("Input from named range feeds the fit exactly its rows (numpy), follows a retarget, and a saved result records the range's name", async () => {
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: "Linear" });
    fireEvent.change(screen.getAllByRole("combobox", { name: "Input from named range" })[0], { target: { value: "nr1:w" } });
    expect(useAnalysisSelection.getState().selection!.items[0].rowRange).toMatchObject({ ...window2144, named: "nr1:w", namedAs: "Window" });
    await fit();
    expect(sent().x).toEqual(rowsOf(20, 43).filter((r) => r !== 25));
    expect(sent().x).toHaveLength(NUMPY_21_44.n);
    const [m1, b1] = lsq(sent());
    expect(m1).toBeCloseTo(NUMPY_21_44.m, 9);
    expect(b1).toBeCloseTo(NUMPY_21_44.b, 9);

    // The saved result carries the window AND the name it was read through.
    const saved = snapshotSaveRange("fit-model", useApp.getState().datasets[0], "this fit");
    expect(saved.range).toEqual({ from: 20, to: 43, rows: N, name: "Window" });
    expect(savedInputRowsLine({ rowRange: saved.range })).toBe("rows 21-44 of 60 (named range Window) (when saved)");

    // Retarget the name to rows 6-15 and fit again: the input followed, no re-pick.
    act(() => void retargetNamedRange("nr1:w", { datasetId: "d", cols: [0], rows: { from: 5, to: 14 } }));
    await fit();
    expect(sent().x).toEqual(rowsOf(5, 14));
    const [m2, b2] = lsq(sent());
    expect(m2).toBeCloseTo(NUMPY_6_15.m, 9);
    expect(b2).toBeCloseTo(NUMPY_6_15.b, 9);
  });

  it("a deleted range refuses the fit with the reason; it never fits every row", async () => {
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: "Linear" });
    fireEvent.change(screen.getAllByRole("combobox", { name: "Input from named range" })[0], { target: { value: "nr1:w" } });
    act(() => useApp.setState({ namedRanges: [] }));
    expect(useAnalysisSelection.getState().selection!.items[0].rowRange).toMatchObject({ named: "nr1:w", refused: "the named range was removed" });
    vi.mocked(fitModel).mockClear();
    await fit();
    expect(fitModel).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/the named range was removed/)).length).toBeGreaterThan(0);
  });
});
