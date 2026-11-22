// Batch Curve Fit inputs by dataset handle (plans/LARGE_PAYLOAD_PLAN.md,
// phase 3 deferred): when the server holds a worksheet, its batch fit names the
// dataset, the channels and the fitted rows instead of posting x/y. The rows
// gather to exactly the x/y the array path posts; a worksheet with no handle
// (and the factor path, whose levels are new objects) posts arrays as before.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { rememberHandle } from "../../../lib/api/datasetCache";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset, FitModel } from "../../../lib/types";
import { gatherRows } from "../../../test/gatherRows";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import CurveFitBatchSection from "./CurveFitBatchSection";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: vi.fn() }));

const LINEAR: FitModel = { name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] };
const sheet = (id: string): Dataset => ({
  id, name: `${id}.csv`,
  // A gap (NaN) at row 2: the fit drops it, so rows are [0,1] + [3,4], not 0..4.
  data: { time: [0, 1, 2, 3, 4], values: [[1], [2], [Number.NaN], [4], [5]], labels: ["Y"], units: [""], metadata: {} },
});

let fetchMock: ReturnType<typeof vi.fn>;
const fitBodies = (): Record<string, unknown>[] =>
  fetchMock.mock.calls.filter(([p]) => p === "/api/fitting/fit").map(([, init]) => JSON.parse(String(init.body)));

function setUp(): Dataset[] {
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
  return datasets;
}

async function runBatch(): Promise<void> {
  render(<CurveFitBatchSection modelName="Linear" model={LINEAR} paramRows={[]} weightMode="none" manualKey={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Linear) batch" }));
  await screen.findByRole("button", { name: "Create summary worksheet" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fitModel).mockResolvedValue({ params: [1, 0], errors: [0, 0], R2: 1, RMSE: 0, chiSqRed: 0, nPoints: 4 });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ params: [1, 0], errors: [0, 0], R2: 1, RMSE: 0, chiSqRed: 0, nPoints: 4 }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("CurveFitBatchSection - inputs by dataset handle", () => {
  it("names the worksheet and the fitted rows when the server holds it, one fit per held worksheet", async () => {
    const datasets = setUp();
    for (const d of datasets) rememberHandle(d.data, `h-${d.id}`);
    await runBatch();
    expect(vi.mocked(fitModel)).not.toHaveBeenCalled(); // no arrays posted
    const bodies = fitBodies();
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).not.toHaveProperty("x");
      expect(body).not.toHaveProperty("y");
      expect(body).toMatchObject({ model: "Linear", x_channel: -1, y_channel: 0, rows: [[0, 2], [3, 2]], return_residuals: false, display_points: 16 });
      const gathered = gatherRows(datasets[0]!.data, body as never);
      expect(gathered).toEqual({ x: [0, 1, 3, 4], y: [1, 2, 4, 5] }); // what the array path posts
    }
  });

  it("posts the arrays for a worksheet the server does not hold", async () => {
    setUp();
    await runBatch();
    expect(fitBodies()).toHaveLength(0);
    const reqs = vi.mocked(fitModel).mock.calls.map((c) => c[0]);
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r).toMatchObject({ x: [0, 1, 3, 4], y: [1, 2, 4, 5] });
  });
});

describe("CurveFitBatchSection - weights by channel", () => {
  const weighted = (id: string): Dataset => ({
    id, name: `${id}.csv`,
    data: {
      time: [0, 1, 2, 3, 4], values: [[1, 0.5], [2, -0.25], [Number.NaN, 0.1], [4, 0.2], [5, 0.4]],
      labels: ["Y", "E"], units: ["", ""], metadata: {},
    },
  });

  it("names the sigma column instead of posting dy", async () => {
    const datasets = [weighted("a"), weighted("b")];
    useApp.setState({
      datasets, activeId: "a", selectedIds: ["a", "b"], analysisResults: [], history: [], future: [],
      resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
    });
    useAnalysisSelection.setState({
      toolId: "curvefit",
      selection: captureAnalysisSelection({
        datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0],
        seriesOrder: null, errKeys: { 0: 1 }, selection: null, range: null,
      }, "library"),
    });
    usePendingOps.setState({ ops: [] });
    for (const d of datasets) rememberHandle(d.data, `h-${d.id}`);
    render(<CurveFitBatchSection modelName="Linear" model={LINEAR} paramRows={[]} weightMode="yerr" manualKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Linear) batch" }));
    await screen.findByRole("button", { name: "Create summary worksheet" });
    expect(vi.mocked(fitModel)).not.toHaveBeenCalled();
    const bodies = fitBodies();
    expect(bodies).toHaveLength(2);
    // The sigma column is the first worksheet's own (the selection carries
    // errKeys per worksheet); the second runs unweighted, with no weights at all.
    expect(bodies[0]).toMatchObject({ dy_channel: 1, rows: [[0, 2], [3, 2]] });
    expect(bodies[0]).not.toHaveProperty("dy");
    expect(bodies[1]).not.toHaveProperty("dy_channel");
    expect(bodies[1]).not.toHaveProperty("dy");
  });
});
