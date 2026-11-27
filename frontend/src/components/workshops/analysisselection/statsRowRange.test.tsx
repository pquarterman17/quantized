// Slice R1, the statistics tools (ROW_RANGE_CONTRACT 3.3, "Who consumes a range"):
// a row range set from the worksheet ("Use as row range", the real
// `openWorksheetRowRange`) narrows every tool whose row policy is
// `analysisView`, through the shared resolver, and each tool's input line says
// so. The fixture is the same one #1107 was checked on: 48 rows, rows 21-44
// selected, 3 excluded inside the window, so 21 rows are analysed.
//
// Values are v = 2 * row + 5 (row 0-based), so every statistic below is
// computed by hand from the row numbers, never from the code under test:
//   included rows = 20..43 minus the excluded 25, 30, 40 -> 21 rows
//   sum of rows   = (20 + 43) * 24 / 2 - (25 + 30 + 40) = 756 - 95 = 661
//   mean of v     = 2 * 661 / 21 + 5

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import { statsGrubbs, statsHistogram, statsRegression, statsShapiro, statsFitDistributions, statsPCA, statsCorrelation } from "../../../lib/api";
import { runStatsTest } from "../../../lib/api/statsTests";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { openWorksheetRowRange } from "../../../store/worksheetAnalysisHandoff";
import { useApp } from "../../../store/useApp";
import DistributionPanel from "../distribution/DistributionPanel";
import { useDistribution } from "../distribution/useDistribution";
import { useFitYByX } from "../fityx/useFitYByX";
import { useMultivar } from "../multivar/useMultivar";
import { useOutlierScreening } from "../outliers/useOutlierScreening";
import { useStatsTests } from "../statstests/useStatsTests";
import { useTabulate } from "../tabulate/useTabulate";
import { useTimeSeries } from "../timeseries/useTimeSeries";
import { useLoadColumns } from "../analysisextras/columnPicks";
import ToolInputSummary from "./ToolInputSummary";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsHistogram: vi.fn(), statsShapiro: vi.fn(), statsFitDistributions: vi.fn(), statsRegression: vi.fn(),
  statsAnova: vi.fn(), statsLevene: vi.fn(), statsTukey: vi.fn(), statsRecommend: vi.fn(),
  statsGrubbs: vi.fn(), statsPCA: vi.fn(), statsCorrelation: vi.fn(), reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));
vi.mock("../../../lib/api/statsCi", () => ({ statsConfidenceIntervals: vi.fn(() => new Promise(() => undefined)) }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: vi.fn(),
}));

const ROWS = 48;
const EXCLUDED = [25, 30, 40];
const RANGE = { from: 20, to: 43 }; // rows 21-44, 1-based
const USED = Array.from({ length: 24 }, (_v, i) => 20 + i).filter((row) => !EXCLUDED.includes(row));
const SUM_ROWS = (20 + 43) * 24 / 2 - (25 + 30 + 40); // 661, by hand
const MEAN_V = 2 * SUM_ROWS / 21 + 5;
const v = (row: number) => 2 * row + 5;

// Column 0 "v" (2 * row + 5), column 1 "w" (row squared), column 2 "o" (one outlier at row 31).
const DATA: DataStruct = {
  time: Array.from({ length: ROWS }, (_v, i) => i),
  values: Array.from({ length: ROWS }, (_v, i) => [v(i), i * i, i === 31 ? 9999 : 100 + (i % 5)]),
  labels: ["v", "w", "o"], units: ["", "", ""], metadata: { x_column_name: "t" },
};
const SHEET: Dataset = { id: "d1", name: "run.csv", data: DATA, excludedRows: EXCLUDED };

const setRange = () => openWorksheetRowRange("d1", Array.from({ length: 24 }, (_v, i) => 20 + i));
const lastArg = <T,>(fn: unknown): T => (fn as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0] as T;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue({ counts: [1], centers: [1], edges: [0, 1000], n_bins: 1, n: 21 } as never);
  vi.mocked(statsShapiro).mockResolvedValue({ W: 0.9, p: 0.5, N: 21 } as never);
  vi.mocked(statsFitDistributions).mockResolvedValue({ fits: [], best: null, skipped: [] } as never);
  // The descriptive statistics, computed from whatever rows the tool sent.
  vi.mocked(statsDescriptive).mockImplementation((async (values: number[]) => ({
    N: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: 0, std: 0, min: Math.min(...values), max: Math.max(...values), q1: 0, q3: 0,
  })) as never);
  vi.mocked(statsRegression).mockResolvedValue({ coeffs: [0, 1], R2: 1, yFit: [], residuals: [] } as never);
  vi.mocked(statsPCA).mockResolvedValue(null as never);
  vi.mocked(statsCorrelation).mockResolvedValue(null as never);
  vi.mocked(runStatsTest).mockResolvedValue({
    id: "anderson", data: { A2: 0.3, N: 21, critical_values: [0.5, 0.6, 0.7, 0.8, 0.9], significance_levels_pct: [15, 10, 5, 2.5, 1], reject_at_5pct: false },
  } as never);
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useOutlierScreeningStore.setState({ open: true, request: null });
  useApp.setState({
    datasets: [SHEET], activeId: "d1", status: "", selection: null, reports: [], distributionOpen: true,
    analysisResults: [], history: [], future: [],
  });
});

describe("a row range narrows the statistics tools (real store)", () => {
  it("Distribution: the line says rows 21-44, 21 rows reach the backend, N and the mean are those rows'", async () => {
    setRange();
    render(<DistributionPanel />);
    await screen.findByLabelText("histogram");
    const sent = lastArg<number[]>(statsDescriptive);
    expect(sent).toEqual(USED.map(v));
    expect(sent).toHaveLength(21);
    expect(sent.reduce((a, b) => a + b, 0) / sent.length).toBeCloseTo(MEAN_V, 9);
    const line = screen.getByLabelText("Analysis input");
    expect(line.textContent).toContain("rows 21-44 · 21 of 24 rows (3 excluded)");
    expect(line.textContent).toContain("Limited to rows 21-44.");
  });

  it("Distribution: brushing a bin selects SOURCE worksheet rows, not positions in the window", async () => {
    setRange();
    // One bin holding every analysed value: brushing it selects exactly the analysed rows.
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    expect(result.current.inputs).toMatchObject({ ok: true, rowCount: 21, rowIds: USED });
    act(() => result.current.brushBins(0, 0, false));
    expect(useApp.getState().selection?.rows).toEqual(USED);
  });

  it("Fit Y by X: x and y are those 21 rows", async () => {
    setRange();
    const { result } = renderHook(() => useFitYByX());
    act(() => { result.current.setXCol(0); result.current.setYCol(1); });
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    const body = lastArg<{ x: number[]; y: number[] }>(statsRegression);
    expect(body.x).toEqual(USED.map(v));
    expect(body.y).toEqual(USED.map((row) => row * row));
    expect(result.current.inputs).toMatchObject({ ok: true, rowCount: 21, rowRange: RANGE });
  });

  it("Multivariate: the columns are read over the 21 rows, with their source rows", () => {
    setRange();
    const { result } = renderHook(() => useMultivar());
    expect(result.current.inputs).toMatchObject({ ok: true, rowCount: 21, rowIds: USED, rowRange: RANGE });
  });

  it("Outlier screening: the column sent has 21 rows and the flagged row is a SOURCE row", async () => {
    setRange();
    // The outlier sits at source row 31 (1-based 32): position 11 of the 21 analysed rows.
    const position = USED.indexOf(31);
    vi.mocked(statsGrubbs).mockResolvedValue({
      G: 3.5, G_critical: 2.1, flagged: true, flagged_indices: [position], index: position, value: 9999, tail: "two-sided",
      alpha: 0.05, N: 21, excluded_indices: [], method: "Grubbs test (single outlier)",
    } as never);
    const { result } = renderHook(() => useOutlierScreening());
    act(() => result.current.setCol(2));
    await waitFor(() => expect(result.current.flaggedRowIndices).toEqual([31]));
    const values = vi.mocked(statsGrubbs).mock.calls.at(-1)![0] as number[];
    expect(values).toHaveLength(21);
    expect(values[position]).toBe(9999);
  });

  it("Statistical tests: Run reads the 21 rows and the saved record counts them", async () => {
    setRange();
    const { result } = renderHook(() => useStatsTests());
    act(() => result.current.setTestId("anderson"));
    act(() => result.current.setSel({ ...result.current.sel, x: 0 }));
    await act(async () => { await result.current.run(); });
    const request = lastArg<{ body: { x: number[] } }>(runStatsTest);
    expect(request.body.x).toEqual(USED.map(v));
    expect(result.current.inputs).toMatchObject({ ok: true, rowCount: 21 });
    const saved = useApp.getState().analysisResults.at(-1)!;
    const recorded = (saved.parameters!["inputs"] as { items: { includedRows: number; rows: number }[] }).items[0];
    expect(recorded).toMatchObject({ includedRows: 21, rows: ROWS });
  });

  it("Tabulate: the summary counts the 21 rows", () => {
    setRange();
    const { result } = renderHook(() => useTabulate());
    act(() => { result.current.setGrandTotal(true); });
    // The grand total is over every row the table was built from.
    const total = result.current.rows.find((row) => row.isTotal)!;
    const stats = total.values[0] as unknown as { count: number; mean: number };
    expect(stats.count).toBe(21);
    expect(stats.mean).toBeCloseTo(MEAN_V, 9);
  });

  it("Time series: the series is the 21 rows", () => {
    setRange();
    const { result } = renderHook(() => useTimeSeries());
    act(() => result.current.setCol(0));
    expect(result.current.inputs).toMatchObject({ ok: true, rowCount: 21, rowRange: RANGE });
  });

  it("Optical gap, Curve measure, Surface and Ellipse fit read through the loader: 21 rows, and only where the line says so", async () => {
    setRange();
    useApp.setState({ resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id) } as never);
    const honouring = renderHook(() => useLoadColumns(true)).result.current;
    const plain = renderHook(() => useLoadColumns()).result.current;
    expect((await honouring("d1", [-1, 0])).columns[0]).toEqual(USED);
    expect((await honouring("d1", [-1, 0], false)).columns[0]).toHaveLength(45); // a second curve: not described by the line
    expect((await plain("d1", [-1, 0])).columns[0]).toHaveLength(45); // a tool without the line never narrows silently
  });
});

describe("the line states what a tool does with the range", () => {
  it("a tool that does not read it says so (Pie, Ternary: not applied), and the numbers stay on every row", () => {
    setRange();
    render(<ToolInputSummary noX load={false} ignoreRowRange columns={[0]} />);
    const text = screen.getByLabelText("Analysis input").textContent!;
    expect(text).toContain("45 of 48 rows");
    expect(text).toContain("The row range (rows 21-44) is not applied.");
    expect(text).not.toContain("Limited to");
  });

  it("without a range the line is exactly what it was", () => {
    render(<ToolInputSummary noX load={false} columns={[0]} />);
    const text = screen.getByLabelText("Analysis input").textContent!;
    expect(text).toContain("45 of 48 rows");
    expect(text).not.toMatch(/row range|Limited to/);
  });

  it("Clear row range restores every row", () => {
    setRange();
    render(<ToolInputSummary noX load={false} columns={[0]} />);
    expect(screen.getByLabelText("Analysis input").textContent).toContain("rows 21-44");
    fireEvent.click(screen.getByRole("button", { name: "Clear row range" }));
    expect(screen.getByLabelText("Analysis input").textContent).toContain("45 of 48 rows");
    expect(useAnalysisSelection.getState().selection!.items[0]!.rowRange).toBeNull();
  });
});
