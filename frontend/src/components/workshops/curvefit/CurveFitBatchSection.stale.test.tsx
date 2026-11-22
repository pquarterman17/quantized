// Curve Fit batch, lane WB5: the table is marked out of date (summary and
// parameter plots withheld) when the settings the fits used, the worksheets
// asked for or their data change. A settings change (model, weighting, start
// table) drops the finished table instead (owner decision 2026-11-22, lane OD).

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset, FitModel } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import CurveFitBatchSection from "./CurveFitBatchSection";

vi.mock("../../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../lib/api")>()), fitModel: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: vi.fn() }));

const sheet = (id: string): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: [""], metadata: {} },
});
const LINEAR: FitModel = { name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] };
const QUAD: FitModel = { name: "Quadratic", category: "polynomial", paramNames: ["a", "b", "c"], nParams: 3, p0: [1, 0, 0], lb: [], ub: [] };

beforeEach(() => {
  vi.clearAllMocks();
  const datasets = [sheet("a"), sheet("b")];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], analysisResults: [], history: [], future: [],
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
  vi.mocked(fitModel).mockResolvedValue({ params: [5, 10], errors: [0.1, 0.2], R2: 0.99, RMSE: 0.1, chiSqRed: 0.01, nPoints: 3 });
});

const base = { modelName: "Linear", model: LINEAR, paramRows: [], weightMode: "none" as const, manualKey: null };

async function ran() {
  const view = render(<CurveFitBatchSection {...base} />);
  fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Linear) batch" }));
  await screen.findByRole("button", { name: "Create summary worksheet" });
  return view;
}

describe("CurveFitBatchSection out of date", () => {
  it("characterization: a fresh run offers the summary, unmarked", async () => {
    await ran();
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(screen.getByRole("button", { name: "Create summary worksheet" })).toBeInTheDocument();
  });

  const START_ROWS = [{ name: "m", start: "3", min: "", max: "", fixed: false }, { name: "b", start: "0", min: "", max: "", fixed: false }];
  const dropped = () => {
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Create summary worksheet" })).toBeNull();
  };

  it.each([
    ["weighting", { weightMode: "poisson" as const }],
    ["start table", { paramRows: START_ROWS }],
    ["model", { modelName: "Quadratic", model: QUAD }],
  ])("a %s change drops the finished table", async (_name, change) => {
    const { rerender } = await ran();
    rerender(<CurveFitBatchSection {...base} {...change} />);
    dropped();
  });

  it("an unchanged rerender keeps the finished table", async () => {
    const { rerender } = await ran();
    rerender(<CurveFitBatchSection {...base} />);
    rerender(<CurveFitBatchSection {...base} paramRows={[]} />);
    expect(screen.getAllByText("Completed").length).toBe(2);
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(screen.getByRole("button", { name: "Create summary worksheet" })).toBeInTheDocument();
  });

  it("a batch still running when settings change lands dropped, as in the other batches", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(fitModel).mockImplementation(async () => { await gate; return { params: [5, 10], errors: [0.1, 0.2], R2: 0.99, RMSE: 0.1, chiSqRed: 0.01, nPoints: 3 }; });
    const { rerender } = render(<CurveFitBatchSection {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Linear) batch" }));
    await screen.findByText("Running…");
    rerender(<CurveFitBatchSection {...base} weightMode="poisson" />);
    release();
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    dropped();
  });

  it("an edit to an input worksheet marks it", async () => {
    await ran();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, excludedRows: [0] } : d)) })));
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create summary worksheet" })).toBeNull();
  });
});
