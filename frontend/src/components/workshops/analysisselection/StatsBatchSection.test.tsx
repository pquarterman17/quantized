// The statistics tools' shared batch (lane BY): Distribution, Fit Y by X and
// Outlier screening over the worksheets selected in the Library, through
// StatsBatchSection + AnalysisBatchControls (inputs "statistics").

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsAnova, statsGrubbs, statsLevene, statsRecommend, statsShapiro } from "../../../lib/api";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import DistributionBatchSection from "../distribution/DistributionBatchSection";
import FitYByXBatchSection from "../fityx/FitYByXBatchSection";
import OutlierBatchSection from "../outliers/OutlierBatchSection";
import type { OutlierScreeningState } from "../outliers/useOutlierScreening";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsShapiro: vi.fn(), statsGrubbs: vi.fn(), statsAnova: vi.fn(), statsLevene: vi.fn(), statsRecommend: vi.fn(),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));

const struct = (labels: string[], values: number[][]): DataStruct => ({
  time: values.map((_row, i) => i), values, labels, units: labels.map(() => ""), metadata: { x_column_name: "T" },
});
// a: Group + Signal; b: Signal laid out in another position; c: no Signal.
const A = struct(["Group", "Signal"], [[0, 1], [0, 2], [1, 3], [1, 4]]);
const B = struct(["Signal", "Group"], [[10, 0], [20, 0], [30, 1], [40, 1]]);
const C = struct(["Other"], [[1], [2], [3], [4]]);
const sheet = (id: string, data: DataStruct, extra: Partial<Dataset> = {}): Dataset =>
  ({ id, name: `${id}.csv`, data, channelTypes: { [data.labels.indexOf("Group")]: "nominal" }, ...extra });

function setup(datasets: Dataset[], rows: number[] | null = null) {
  useApp.setState({
    datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: [1], seriesOrder: null,
    errKeys: {}, selection: rows ? { datasetId: "a", rows } : null, analysisResults: [], history: [], future: [], status: "",
    resolveDataset: async (id: string) => useApp.getState().datasets.find((dataset) => dataset.id === id),
  });
}

const openBatch = () => fireEvent.click(screen.getByRole("button", { name: /Batch over selected worksheets/ }));
const run = (label: string) => fireEvent.click(screen.getByRole("button", { name: `Run ${label} batch` }));
const savedRows = () => (register.mock.calls[0]![0] as AnalysisResult).tables![0]!.rows as unknown[][];

// The run's last act is its status line: wait on that state, then read the result.
const finished = () => waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.setState({ toolId: null, selection: null });
  usePendingOps.setState({ ops: [] });
  vi.mocked(statsDescriptive).mockImplementation(async (v: number[]) => ({
    N: v.length, mean: v.reduce((s, x) => s + x, 0) / v.length, median: 0, std: 1, min: Math.min(...v), max: Math.max(...v),
  }));
  vi.mocked(statsShapiro).mockResolvedValue({ W: 0.9, p: 0.5, N: 4 });
});

describe("Distribution batch", () => {
  it("claims no analysis selection until the user opens it", () => {
    setup([sheet("a", A), sheet("b", B)]);
    render(<DistributionBatchSection column="Signal" />);
    expect(useAnalysisSelection.getState().toolId).toBeNull();
    openBatch();
    expect(useAnalysisSelection.getState().toolId).toBe("distribution");
  });

  it("profiles each worksheet's column of the same name; a worksheet without it is an error row", async () => {
    // The plot's Y (column 1) does not exist in c: the statistics batch reads
    // by name, so that plot role must not block the batch.
    setup([sheet("a", A), sheet("b", B), sheet("c", C, { channelTypes: {} })]);
    render(<DistributionBatchSection column="Signal" />);
    openBatch();
    run("Distribution");
    await finished();
    const rows = savedRows();
    expect(rows.map((r) => [r[0], r[1], r[3], r[4]])).toEqual([
      ["a.csv", "Completed", 4, 2.5],
      ["b.csv", "Completed", 4, 25],
      ["c.csv", "Failed", null, null],
    ]);
    expect(rows[2]!.at(-1)).toBe('No column named "Signal" in this worksheet.');
    expect(register.mock.calls[0]![0].parameters).toMatchObject({ toolId: "distribution", column: "Signal" });
  });

  it("reads the analysis view, like the single run: selected rows do not narrow it", async () => {
    setup([sheet("a", A, { excludedRows: [0] }), sheet("b", B)], [1, 2]);
    render(<DistributionBatchSection column="Signal" />);
    openBatch();
    run("Distribution");
    await finished();
    // a: 3 rows (one excluded; the 2 selected rows are not a narrowing).
    expect(savedRows().map((r) => [r[2], r[3]])).toEqual([[3, 3], [4, 4]]);
    const saved = (register.mock.calls[0]![0] as AnalysisResult).parameters!.selection as { items: { rowRuns: unknown; range: unknown }[] };
    expect(saved.items.map((item) => [item.rowRuns, item.range])).toEqual([[null, null], [null, null]]);
  });

  it("records a missing normality test as a warning, not a failure", async () => {
    vi.mocked(statsShapiro).mockRejectedValue(new Error("n too small"));
    setup([sheet("a", A)]);
    render(<DistributionBatchSection column="Signal" />);
    openBatch();
    run("Distribution");
    await finished();
    expect(savedRows()[0]!.slice(0, 2)).toEqual(["a.csv", "Completed"]);
    expect(savedRows()[0]!.at(-1)).toBe("Normality: normality test unavailable.");
  });

  it("says when another tool's batch holds the selection, and takes it back on request", () => {
    setup([sheet("a", A), sheet("b", B)]);
    render(<DistributionBatchSection column="Signal" />);
    openBatch();
    act(() => { useAnalysisSelection.setState({ toolId: "curvefit" }); });
    expect(screen.getByText(/Another tool is using the Library selection/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use it for Distribution" }));
    expect(useAnalysisSelection.getState().toolId).toBe("distribution");
    expect(screen.getByRole("button", { name: "Run Distribution batch" })).toBeEnabled();
  });

  it("starts a fresh table when the panel's column changes after a run", async () => {
    setup([sheet("a", A)]);
    const { rerender } = render(<DistributionBatchSection column="Signal" />);
    openBatch();
    run("Distribution");
    await finished();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    rerender(<DistributionBatchSection column="Group" />);
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("refuses to run without a column", () => {
    setup([sheet("a", A)]);
    render(<DistributionBatchSection column={null} />);
    openBatch();
    expect(screen.getByRole("button", { name: "Run Distribution batch" })).toBeDisabled();
    expect(screen.getAllByText("Pick a column to profile first.").length).toBeGreaterThan(0);
  });

  it("cancels between worksheets: the in-flight one finishes, the rest are Cancelled", async () => {
    setup([sheet("a", A), sheet("b", B)]);
    let release!: () => void;
    vi.mocked(statsDescriptive).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ N: 4, mean: 2.5 });
    }));
    render(<DistributionBatchSection column="Signal" />);
    openBatch();
    run("Distribution");
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    usePendingOps.getState().ops[0]!.cancel?.();
    release();
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(savedRows().map((r) => r[1])).toEqual(["Completed", "Cancelled"]);
  });
});

describe("Fit Y by X batch", () => {
  beforeEach(() => {
    vi.mocked(statsAnova).mockResolvedValue({ fStat: 9, pValue: 0.01 });
    vi.mocked(statsLevene).mockResolvedValue({ W: 0.1, p: 0.9 });
    vi.mocked(statsRecommend).mockResolvedValue({ recommendation: "ANOVA", endpoint: "", parametric: true, n_groups: 2, paired: false, checks: { alpha: 0.05, shapiro_p: [] }, reasons: [] });
  });

  it("runs the panel's leg on each worksheet's same-named columns and refuses a different leg", async () => {
    // b's Group reads as continuous: there it would be a bivariate fit.
    setup([sheet("a", A), sheet("b", B, { channelTypes: {} })]);
    render(<FitYByXBatchSection xLabel="Group" yLabel="Signal" kind="oneway" order={1} />);
    openBatch();
    run("Fit Y by X");
    await finished();
    const rows = savedRows();
    expect(rows[0]!.slice(0, 7)).toEqual(["a.csv", "Completed", 4, 2, 4, 9, 0.01]);
    expect(rows[1]!.slice(0, 2)).toEqual(["b.csv", "Failed"]);
    expect(rows[1]!.at(-1)).toMatch(/is a bivariate analysis, not oneway/);
    expect(register.mock.calls[0]![0].tables[0].columns).toEqual(["Worksheet", "Status", "Rows", "Groups", "N", "F", "p", "Warnings"]);
  });

  it("is blocked for the unsupported combination", () => {
    setup([sheet("a", A)]);
    render(<FitYByXBatchSection xLabel="Signal" yLabel="Group" kind="unsupported" order={1} />);
    openBatch();
    expect(screen.getByRole("button", { name: "Run Fit Y by X batch" })).toBeDisabled();
  });
});

describe("Outlier screening batch", () => {
  it("screens each worksheet's same-named channel with the panel's method", async () => {
    vi.mocked(statsGrubbs).mockImplementation(async (x: number[]) => ({
      G: 1, G_critical: 2, flagged: true, flagged_indices: [x.length - 1], index: x.length - 1, value: x.at(-1)!,
      tail: "two-sided", alpha: 0.05, N: x.length, excluded_indices: [], method: "Grubbs",
    }));
    setup([sheet("a", A), sheet("b", B)]);
    const o = { col: 1, method: "grubbs", alpha: 0.05, k: 2, threshold: 3.5, columns: [{ index: -1, label: "T" }, { index: 0, label: "Group" }, { index: 1, label: "Signal" }] };
    render(<OutlierBatchSection o={o as unknown as OutlierScreeningState} />);
    openBatch();
    run("Outlier screening");
    await finished();
    expect(savedRows().map((r) => r.slice(3, 6))).toEqual([[4, 1, "4"], [4, 1, "40"]]);
    expect(register.mock.calls[0]![0].parameters).toMatchObject({ channel: "Signal", method: "grubbs", alpha: 0.05 });
  });
});
