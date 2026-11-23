// Pawley batch "Create model worksheets": per chosen row, one observed / model /
// background / residual worksheet through the shared commit contract (one undo
// step, a repeat adds nothing, out of date on a source change, linked to its
// source, a row that cannot be written listed with its reason).

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pawleyRefine } from "../../../lib/api/reductions";
import type { PawleyResult } from "../../../lib/reductionTypes";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PawleySection from "./PawleySection";

vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: vi.fn() }));
vi.mock("../../../lib/api/reductions", () => ({
  fftThickness: vi.fn(), reflectivityFft: vi.fn(), pawleyRefine: vi.fn(),
  xrdPhases: vi.fn(async () => ({ phases: [], default_wavelength: 1.5406 })),
}));

const scan = (labels: string[], values: number[][]): DataStruct => ({
  time: [20, 30, 40, 50], values, labels, units: labels.map(() => ""),
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg" },
});
const A = scan(["Intensity"], [[1], [2], [3], [4]]);
const B = scan(["Intensity"], [[10], [20], [30], [40]]);
const C = scan(["Counts"], [[1], [2], [3], [4]]);
const sheet = (id: string, data: DataStruct): Dataset => ({ id, name: `${id}.xy`, data });
const result: PawleyResult = {
  cell: [5.42, 5.42, 5.42, 90, 90, 90], cell_initial: [5.43, 5.43, 5.43, 90, 90, 90], scale: null, peaks: [],
  background: [0, 0, 0, 0], model: [1, 2, 3, 4], residual: [0, 0, 0, 0], rwp: 0.05, rwp_initial: 0.2, rwp_background: 0.5,
  converged: true, tie: "abc", hkl_max: 8, n_peaks: 7,
};

function setup(datasets: Dataset[]) {
  useApp.setState({
    datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: [0], seriesOrder: null,
    errKeys: {}, selection: null, analysisResults: [], history: [], future: [], status: "",
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
}
async function runBatch() {
  fireEvent.click(screen.getByRole("button", { name: /Batch over selected worksheets/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run Pawley batch" }));
  await waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));
  await screen.findByRole("button", { name: /Create model worksheets/ });
}
const create = () => fireEvent.click(screen.getByRole("button", { name: /Create model worksheets/ }));
const outputs = () => useApp.getState().datasets.filter((d) => d.name.endsWith("(Pawley)"));

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.setState({ toolId: null, selection: null });
  usePendingOps.setState({ ops: [] });
  vi.mocked(pawleyRefine).mockResolvedValue(result);
});

describe("Pawley batch model worksheets", () => {
  it("adds one linked worksheet per completed row in ONE undo step, and a repeat adds nothing", async () => {
    setup([sheet("a", A), sheet("b", B), sheet("c", C)]);
    render(<PawleySection />);
    await runBatch();
    // The failed row is listed with its reason, not offered.
    expect(screen.getByText(/c\.xy \(/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create model worksheets (2)" })).toBeInTheDocument();
    const before = useApp.getState().history.length;
    create();
    expect(outputs().map((d) => d.name)).toEqual(["a.xy (Pawley)", "b.xy (Pawley)"]);
    expect(outputs()[1]!.data.values[1]).toEqual([20, 2, 0, 0]);
    expect(outputs()[0]!.data.labels).toEqual(["Intensity", "Pawley model", "Background", "Residual"]);
    expect(useApp.getState().history.length).toBe(before + 1);
    const links = useApp.getState().analysisResults.map((r) => r.sources.map((s) => s.datasetId));
    expect(links).toEqual([["a"], ["b"]]);
    expect(screen.getByRole("status", { name: "model worksheet report" })).toHaveTextContent("2 added, 0 already added");

    for (const r of useApp.getState().analysisResults) {
      // 2θ is the worksheet's own X (the refinement reads its time axis): C9 records that range.
      expect(r.parameters?.["inputs"]).toMatchObject({ items: [{ xRange: [20, 50] }] });
    }

    create();
    expect(outputs()).toHaveLength(2);
    expect(useApp.getState().history.length).toBe(before + 1);
    expect(screen.getByRole("status", { name: "model worksheet report" })).toHaveTextContent("0 added, 2 already added");

    act(() => useApp.getState().undo());
    expect(outputs()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("only the chosen rows are written", async () => {
    setup([sheet("a", A), sheet("b", B)]);
    render(<PawleySection />);
    await runBatch();
    fireEvent.click(screen.getByRole("checkbox", { name: "b.xy" }));
    create();
    expect(outputs().map((d) => d.name)).toEqual(["a.xy (Pawley)"]);
  });

  it("withholds the button once a fitted worksheet changed, and refuses a row whose source changed", async () => {
    setup([sheet("a", A), sheet("b", B)]);
    render(<PawleySection />);
    await runBatch();
    act(() => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, excludedRows: [0] } : d)) }));
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Create model worksheets/ })).toBeNull());
    expect(outputs()).toHaveLength(0);
  });

  it("an output goes out of date when its source worksheet changes", async () => {
    setup([sheet("a", A), sheet("b", B)]);
    render(<PawleySection />);
    await runBatch();
    create();
    const outId = outputs()[0]!.id;
    act(() => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, data: { ...d.data, time: [20, 30, 40, 51] } } : d)) }));
      useApp.getState().touchDataset("a");
    });
    expect(useApp.getState().staleDatasets).toContain(outId);
  });
});
