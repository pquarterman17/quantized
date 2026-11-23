// Curve Fit result worksheets on the shared result contract (audit rows 36/37):
// "Write to worksheet" and "Create summary worksheet" commit one undo step with
// a recorded result, add nothing on a repeat (and say so), and go Out of date
// when the fitted worksheet changes.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { INPUTS_PARAM } from "../../../lib/resultInputsRecord";
import type { Dataset, FitModel } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import CurveFitBatchSection from "./CurveFitBatchSection";
import FitOutputSection from "./FitOutputSection";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));

const DS: Dataset = {
  id: "d1", name: "run.dat",
  data: { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["M"], units: ["emu"], metadata: {} },
  fitSpec: { model: "Pseudo-Voigt", params: [1, 1, 1, 0.5] },
};
const RESULT = { params: [2, 1], errors: [0.1, 0.1], covar: [[0.01, 0], [0, 0.01]], yFit: [1, 3, 5], residuals: [0, 0, 0], nPoints: 3, nFree: 2 };
const FIT = { x: [0, 1, 2], y: [1, 3, 5], xKey: null, yKey: 0, dy: null };

const reset = (datasets: Dataset[]) => useApp.setState({
  datasets, activeId: datasets[0]!.id, analysisResults: [], history: [], future: [], staleDatasets: [], recalcMode: "manual",
  resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
});
const added = () => useApp.getState().datasets.filter((d) => !["d1", "a", "b"].includes(d.id));

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
});

describe("FitOutputSection — result worksheet lifecycle", () => {
  const renderIt = () => {
    render(<FitOutputSection dataset={DS} model="Pseudo-Voigt" paramNames={["A", "x0", "w", "eta"]} result={RESULT} fitData={FIT} />);
    fireEvent.click(screen.getByText("Output to worksheet"));
  };

  it("records the inputs and settings, as one undo step", async () => {
    reset([DS]);
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Write to worksheet" }));
    await waitFor(() => expect(added()).toHaveLength(1));
    const s = useApp.getState();
    expect(s.history).toHaveLength(1);
    const [result] = s.analysisResults;
    expect(result!.producer).toEqual({ id: "curvefit-results", label: "Curve Fit results", version: 1 });
    expect(result!.sources).toEqual([{ datasetId: "d1", role: "input" }]);
    expect(result!.outputs[0]!.datasetId).toBe(added()[0]!.id);
    expect((result!.parameters?.[INPUTS_PARAM] as { items: { channels: unknown[] }[] }).items[0]!.channels).toEqual([{ index: 0, label: "M", unit: "emu" }]);
    s.undo();
    expect(added()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("records the X column the fit read: a channel X is that channel's range, the time axis is the time range (C9)", async () => {
    const TWO: Dataset = {
      ...DS, id: "d1",
      data: { time: [0, 1, 2], values: [[10, 1], [20, 3], [30, 5]], labels: ["T", "M"], units: ["K", "emu"], metadata: {} },
    };
    const range = async (xKey: number | null) => {
      reset([TWO]);
      const view = render(<FitOutputSection dataset={TWO} model="Pseudo-Voigt" paramNames={["A", "x0", "w", "eta"]} result={RESULT} fitData={{ ...FIT, xKey, yKey: 1 }} />);
      fireEvent.click(screen.getByText("Output to worksheet"));
      fireEvent.click(screen.getByRole("button", { name: "Write to worksheet" }));
      await waitFor(() => expect(added()).toHaveLength(1));
      const item = (useApp.getState().analysisResults[0]!.parameters?.[INPUTS_PARAM] as { items: { xRange: unknown; xLabel: unknown }[] }).items[0]!;
      view.unmount();
      return item;
    };
    expect(await range(0)).toMatchObject({ xRange: [10, 30], xLabel: "T" });
    expect(await range(null)).toMatchObject({ xRange: [0, 2] });
  });

  it("a repeat click adds nothing and says it is already added", async () => {
    reset([DS]);
    renderIt();
    const button = screen.getByRole("button", { name: "Write to worksheet" });
    fireEvent.click(button);
    await waitFor(() => expect(added()).toHaveLength(1));
    fireEvent.click(button);
    await waitFor(() => expect(useApp.getState().status).toMatch(/already added as “run\.dat — Pseudo-Voigt fit results”; nothing was duplicated/));
    expect(added()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("a different output (another column choice) is a different output, not a duplicate", async () => {
    reset([DS]);
    renderIt();
    const button = screen.getByRole("button", { name: "Write to worksheet" });
    fireEvent.click(button);
    await waitFor(() => expect(added()).toHaveLength(1));
    fireEvent.click(screen.getByRole("checkbox", { name: "Residual" }));
    fireEvent.click(button);
    await waitFor(() => expect(added()).toHaveLength(2));
  });

  it("goes Out of date when the fitted worksheet changes", async () => {
    reset([DS]);
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Write to worksheet" }));
    await waitFor(() => expect(added()).toHaveLength(1));
    useApp.getState().touchDataset("d1");
    expect(useApp.getState().staleDatasets).toEqual([added()[0]!.id]);
  });

  it("refuses, writing nothing, when the fitted worksheet changed after the fit", async () => {
    reset([DS]);
    render(<FitOutputSection dataset={DS} model="Pseudo-Voigt" paramNames={["A", "x0", "w", "eta"]} result={RESULT} fitData={FIT} />);
    fireEvent.click(screen.getByText("Output to worksheet"));
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data, values: [[9], [9], [9]] } })) }));
    fireEvent.click(screen.getByRole("button", { name: "Write to worksheet" }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/changed after this result was computed/));
    expect(added()).toHaveLength(0);
  });
});

describe("CurveFitBatchSection — summary worksheet lifecycle", () => {
  const sheet = (id: string): Dataset => ({
    id, name: `${id}.csv`, data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: [""], metadata: {} },
  });
  const LINEAR: FitModel = { name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] };

  async function ran() {
    const datasets = [sheet("a"), sheet("b")];
    reset(datasets);
    useApp.setState({ selectedIds: ["a", "b"] });
    useAnalysisSelection.setState({
      toolId: "curvefit",
      selection: captureAnalysisSelection({
        datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0],
        seriesOrder: null, errKeys: {}, selection: null, range: null,
      }, "library"),
    });
    vi.mocked(fitModel).mockResolvedValue({ params: [5, 10], errors: [0.1, 0.2], R2: 0.99, RMSE: 0.1, chiSqRed: 0.01, nPoints: 3 });
    render(<CurveFitBatchSection modelName="Linear" model={LINEAR} paramRows={[]} weightMode="none" manualKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Run Curve Fit (Linear) batch" }));
    return screen.findByRole("button", { name: "Create summary worksheet" });
  }

  it("commits with both inputs as sources, one undo step, and a repeat adds nothing", async () => {
    const button = await ran();
    const before = useApp.getState().history.length;
    fireEvent.click(button);
    expect(added()).toHaveLength(1);
    const state = useApp.getState();
    expect(state.history.length).toBe(before + 1);
    const result = state.analysisResults.find((r) => r.producer.id === "curvefit-batch-summary")!;
    expect(result.sources.map((s) => s.datasetId).sort()).toEqual(["a", "b"]);
    fireEvent.click(button);
    expect(added()).toHaveLength(1);
    expect(useApp.getState().history.length).toBe(before + 1);
    expect(useApp.getState().status).toMatch(/already added as/);
    useApp.getState().undo();
    expect(added()).toHaveLength(0);
  });

  it("goes Out of date when ANY input worksheet changes", async () => {
    fireEvent.click(await ran());
    const out = added()[0]!.id;
    useApp.getState().touchDataset("b");
    expect(useApp.getState().staleDatasets).toEqual([out]);
  });
});
