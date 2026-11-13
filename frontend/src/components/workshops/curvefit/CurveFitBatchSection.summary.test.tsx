// Curve Fit batch -> "Create summary worksheet": the sheet describes the RUN.
// Picking another model after a run (the button stays, with the run's rows)
// used to label the run's values with the NEW model's parameter names and
// name the sheet after the new model.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset, FitModel } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import CurveFitBatchSection from "./CurveFitBatchSection";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: vi.fn() }));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(async (_m: string, _x: number[], y: number[]) => ({ p0: [y[0]! * 100, 2, 0.5] })),
}));

const sheet = (id: string): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: [""], metadata: {} },
});
const GAUSS: FitModel = { name: "Gaussian", category: "peak", paramNames: ["A", "mu", "sigma"], nParams: 3, p0: [1, 1, 1], lb: [], ub: [] };
const LINEAR: FitModel = { name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] };

beforeEach(() => {
  vi.clearAllMocks();
  const datasets = [sheet("a"), sheet("b")];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], analysisResults: [], history: [], future: [],
    resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
  vi.mocked(fitModel).mockResolvedValue({ params: [5, 10, 1.5], errors: [0.1, 0.2, 0.3], R2: 0.99, RMSE: 0.1, chiSqRed: 0.01, nPoints: 3 });
});

describe("CurveFitBatchSection — summary worksheet row order", () => {
  it("lists the inputs in Library order whatever order the batch ran them in", async () => {
    // The selection starts with the ACTIVE worksheet ("b"), so the run is b, a.
    // "b" holds different data so its row is told apart by its value.
    const datasets = useApp.getState().datasets.map((d) => (d.id === "b" ? { ...d, data: { ...d.data, values: [[7], [8], [9]] } } : d));
    useApp.setState({ datasets, activeId: "b", resolveDataset: async (id: string) => datasets.find((d) => d.id === id) });
    useAnalysisSelection.setState({
      toolId: "curvefit",
      selection: captureAnalysisSelection({
        datasets, activeId: "b", selectedIds: ["b", "a"], xKey: null, yKeys: [0],
        seriesOrder: null, errKeys: {}, selection: null, range: null,
      }, "library"),
    });
    vi.mocked(fitModel).mockImplementation(async (req) => ({ params: [req.y[0] === 1 ? 10 : 20, 0, 0], errors: [0, 0, 0], R2: 1, RMSE: 0, chiSqRed: 0, nPoints: 3 }));
    render(<CurveFitBatchSection modelName="Gaussian" model={GAUSS} paramRows={[]} weightMode="none" manualKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Gaussian) batch" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create summary worksheet" }));
    const added = useApp.getState().datasets.at(-1)!;
    const text = (added.data.metadata as { text_columns: { Worksheet: string[] } }).text_columns;
    // Before the fix: ["b.csv", "a.csv"] (run order).
    expect(text.Worksheet).toEqual(["a.csv", "b.csv"]);
    expect(added.data.values.map((r) => r[6])).toEqual([10, 20]);
  });
});

describe("CurveFitBatchSection — summary worksheet", () => {
  it("keeps the run's model and parameter columns after the panel's model changes", async () => {
    const props = { paramRows: [], weightMode: "none" as const, manualKey: null };
    const { rerender } = render(<CurveFitBatchSection modelName="Gaussian" model={GAUSS} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Gaussian) batch" }));
    await screen.findByRole("button", { name: "Create summary worksheet" });
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));

    rerender(<CurveFitBatchSection modelName="Linear" model={LINEAR} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Create summary worksheet" }));
    const added = useApp.getState().datasets.at(-1)!;
    expect(added.name).toBe("Curve Fit summary — Gaussian (2 worksheets)");
    expect(added.data.labels).toEqual(["Levels", "Completed", "N", "R²", "Reduced χ²", "RMSE", "A", "A SE", "mu", "mu SE", "sigma", "sigma SE"]);
    expect(added.data.values[0]).toEqual([1, 1, 3, 0.99, 0.01, 0.1, 5, 0.1, 10, 0.2, 1.5, 0.3]);
    expect((added.data.metadata as { curveFitBatch: { model: string } }).curveFitBatch.model).toBe("Gaussian");
    // The summary lands in the Library without taking the plot or the batch
    // selection (it used to become the active dataset and the only input).
    expect(useApp.getState().activeId).toBe("a");
    expect(useApp.getState().selectedIds).toEqual(["a", "b"]);
  });
});

describe("CurveFitBatchSection — weighting", () => {
  it("honours the panel's 'Scale errors with √(reduced χ²)' switch for weighted inputs", async () => {
    // Poisson weighting needs positive counts: the sheets hold 1, 2, 3.
    render(<CurveFitBatchSection modelName="Gaussian" model={GAUSS} paramRows={[]} weightMode="poisson" manualKey={null} scaleErrors={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Gaussian) batch" }));
    await screen.findByRole("button", { name: "Create summary worksheet" });
    const reqs = vi.mocked(fitModel).mock.calls.map((c) => c[0]);
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r).toMatchObject({ dy: [1, Math.SQRT2, Math.sqrt(3)], scale_errors: false });
  });

  it("an edited table's unchosen starts come from each input's own data", async () => {
    const rows = [
      { name: "A", start: "1", min: "", max: "", fixed: false }, // still the seeded default: auto
      { name: "mu", start: "1", min: "", max: "", fixed: false },
      { name: "sigma", start: "0.3", min: "", max: "", fixed: true }, // held at a typed value
    ];
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "b" ? { ...d, data: { ...d.data, values: [[7], [8], [9]] } } : d)) }));
    const datasets = useApp.getState().datasets;
    useApp.setState({ resolveDataset: async (id: string) => datasets.find((d) => d.id === id) });
    render(<CurveFitBatchSection modelName="Gaussian" model={GAUSS} paramRows={rows} weightMode="none" manualKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Gaussian) batch" }));
    await screen.findByRole("button", { name: "Create summary worksheet" });
    const p0s = vi.mocked(fitModel).mock.calls.map((c) => c[0].p0);
    expect(p0s).toEqual(expect.arrayContaining([[100, 2, 0.3], [700, 2, 0.3]]));
  });

  it("names direct weighting, not manual, when it cannot be used", async () => {
    render(<CurveFitBatchSection modelName="Gaussian" model={GAUSS} paramRows={[]} weightMode="direct" manualKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Gaussian) batch" }));
    await screen.findByRole("button", { name: "Create summary worksheet" });
    expect(screen.getAllByText(/Direct weighting was not configured/).length).toBeGreaterThan(0);
  });
});
