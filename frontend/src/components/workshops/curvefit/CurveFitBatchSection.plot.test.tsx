// Curve Fit batch -> "Plot ▸ τ": the one-click path from a finished batch to a
// parameter-vs-temperature plot (UX audit 9 finding 4).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { buildColumns } from "../../../lib/plotdata";
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

const sheet = (t: number): Dataset => ({
  id: `${t}K`, name: `decay_${String(t).padStart(3, "0")}K.csv`,
  data: { time: [0, 1, 2], values: [[t], [t + 1], [t + 2]], labels: ["Y"], units: [""], metadata: {} },
});
const EXP: FitModel = { name: "Exponential Decay", category: "decay", paramNames: ["A", "tau", "C"], nParams: 3, p0: [1, 1, 0], lb: [], ub: [] };

beforeEach(() => {
  vi.clearAllMocks();
  // Library order 10 K, 50 K, 300 K; the ACTIVE sheet is the last one.
  const datasets = [10, 50, 300].map(sheet);
  const ids = datasets.map((d) => d.id);
  useApp.setState({
    datasets, activeId: "300K", selectedIds: ids, analysisResults: [], history: [], future: [],
    resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({
      datasets, activeId: "300K", selectedIds: ids, xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
  vi.mocked(fitModel).mockImplementation(async (req) => ({
    params: [1, req.y[0]!, 0], errors: [0, 0, 0], R2: 0.99, RMSE: 0.1, chiSqRed: 0.01, nPoints: 3,
  }));
});

describe("CurveFitBatchSection — Plot ▸ parameter", () => {
  it("opens with the batch visible, runs in Library order, and plots only tau against Temperature (K)", async () => {
    render(<CurveFitBatchSection modelName="Exponential Decay" model={EXP} paramRows={[]} weightMode="none" manualKey={null} />);
    // Open by default for a multi-worksheet launch, listed in Library order.
    const names = screen.getAllByRole("row").slice(1).map((r) => (r as HTMLTableRowElement).cells[0]!.textContent);
    expect(names).toEqual(["decay_010K.csv", "decay_050K.csv", "decay_300K.csv"]);
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Exponential Decay) batch" }));
    fireEvent.click(await screen.findByRole("button", { name: "tau" }));

    // The batch ran 10 K first although 300 K was the active sheet.
    expect(vi.mocked(fitModel).mock.calls.map((c) => c[0].y[0])).toEqual([10, 50, 300]);
    const s = useApp.getState();
    const summary = s.datasets.at(-1)!;
    expect(s.activeId).toBe(summary.id);
    expect(s.yKeys).toHaveLength(1);
    expect(summary.data.labels[s.yKeys![0]!]).toBe("tau");
    expect(s.y2Keys?.map((k) => summary.data.labels[k])).toEqual(["R²"]);
    expect(s.xKey).toBeNull();
    const p = buildColumns(summary.data, s.y2Keys, s.xKey, s.yKeys);
    expect(p.xLabel).toBe("Temperature");
    expect(p.xUnit).toBe("K");
    expect(p.data[0]).toEqual([10, 50, 300]); // sorted by the number in the name
    expect(p.series.map((x) => x.label)).toEqual(["tau"]);

    // A second chip reuses the same summary worksheet.
    const before = s.datasets.length;
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(useApp.getState().datasets).toHaveLength(before);
  });
});
