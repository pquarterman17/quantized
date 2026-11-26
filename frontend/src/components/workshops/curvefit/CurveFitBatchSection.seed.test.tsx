// Curve Fit batch, "Start each fit from the previous result": off by default
// (requests identical to before); on, each fit starts from the previous
// converged parameters (clamped, held ones held) and a fit that did not
// converge hands nothing on and is flagged.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset, FitModel } from "../../../lib/types";
import { registerAnalysisResult } from "../../../store/analysisResultActions";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import CurveFitBatchSection from "./CurveFitBatchSection";
import { rowsFromModel, type FitParamRow } from "../../../lib/fitParams";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: vi.fn() }));

const LINEAR: FitModel = { name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] };
const sheet = (id: string): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: [""], metadata: {} },
});
const ok = (params: number[], exitFlag = 1) => ({ params, errors: [0, 0], R2: 1, RMSE: 0, chiSqRed: 0, nPoints: 3, exitFlag });
const row = (name: string, start: string, over: Partial<FitParamRow> = {}): FitParamRow => ({ name, start, min: "", max: "", fixed: false, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fitModel).mockReset();
  const datasets = ["a", "b", "c"].map(sheet);
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b", "c"], analysisResults: [], history: [], future: [],
    resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a", "b", "c"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
});

async function run(paramRows: FitParamRow[] = rowsFromModel(LINEAR), seed = false) {
  render(<CurveFitBatchSection modelName="Linear" model={LINEAR} paramRows={paramRows} weightMode="none" manualKey={null} />);
  if (seed) fireEvent.click(screen.getByRole("checkbox", { name: "Start each fit from the previous result" }));
  fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Linear) batch" }));
  await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  await screen.findByRole("button", { name: "Create summary worksheet" });
}
const bodies = () => vi.mocked(fitModel).mock.calls.map(([req]) => req as unknown as { p0?: number[]; lower?: number[]; fixed?: boolean[] });

describe("CurveFitBatchSection - start from the previous result", () => {
  it("is off by default: no fit carries a start from another", async () => {
    vi.mocked(fitModel).mockResolvedValue(ok([2, 3]));
    await run();
    expect(bodies().map((b) => b.p0)).toEqual([undefined, undefined, undefined]);
    const saved = vi.mocked(registerAnalysisResult).mock.calls[0]![0];
    expect(saved.parameters).not.toHaveProperty("seedFromPrevious");
  });

  it("starts each fit from the previous converged parameters and records the mode", async () => {
    vi.mocked(fitModel)
      .mockResolvedValueOnce(ok([2, 3])).mockResolvedValueOnce(ok([4, 5])).mockResolvedValueOnce(ok([6, 7]));
    await run(undefined, true);
    expect(bodies().map((b) => b.p0)).toEqual([undefined, [2, 3], [4, 5]]);
    expect(vi.mocked(registerAnalysisResult).mock.calls[0]![0].parameters).toMatchObject({ seedFromPrevious: true });
    fireEvent.click(screen.getByRole("button", { name: "Create summary worksheet" }));
    const added = useApp.getState().datasets.at(-1)!;
    expect((added.data.metadata as { curveFitBatch: { seedFromPrevious: boolean } }).curveFitBatch.seedFromPrevious).toBe(true);
  });

  it("clamps the seed into the bounds and keeps a held parameter at its panel value", async () => {
    vi.mocked(fitModel).mockResolvedValueOnce(ok([50, 9])).mockResolvedValue(ok([1, 2]));
    await run([row("m", "2", { min: "0", max: "10" }), row("b", "0.5", { fixed: true })], true);
    const second = bodies()[1]!;
    expect(second.p0).toEqual([10, 0.5]);
    expect(second.fixed).toEqual([false, true]);
  });

  it("falls back to the panel's starts after a fit that did not converge, and flags it", async () => {
    vi.mocked(fitModel)
      .mockResolvedValueOnce(ok([2, 3])).mockResolvedValueOnce(ok([9, 9], 0)).mockResolvedValueOnce(ok([6, 7]));
    await run(undefined, true);
    expect(bodies().map((b) => b.p0)).toEqual([undefined, [2, 3], undefined]);
    expect(await screen.findByText(/Did not converge: the next worksheet starts from the panel's start values/)).toBeTruthy();
  });

  it("falls back after a fit that threw", async () => {
    vi.mocked(fitModel)
      .mockResolvedValueOnce(ok([2, 3])).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(ok([6, 7]));
    await run(undefined, true);
    expect(bodies().map((b) => b.p0)).toEqual([undefined, [2, 3], undefined]);
  });
});
