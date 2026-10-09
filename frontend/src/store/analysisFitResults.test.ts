import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitAnalysisResult } from "../lib/fitAnalysisResult";
import type { Dataset, FitSpec } from "../lib/types";

const mocks = vi.hoisted(() => ({
  fitModel: vi.fn(), fitBands: vi.fn(), listFitModels: vi.fn(), saveBlob: vi.fn(),
}));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()), fitModel: mocks.fitModel,
}));
vi.mock("../lib/api/fitStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api/fitStats")>()), fitBands: mocks.fitBands,
}));
vi.mock("../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api/curvefit")>()), listFitModels: mocks.listFitModels,
}));
vi.mock("../lib/download", () => ({ saveBlob: mocks.saveBlob }));

import {
  exportAnalysisFitTable,
  prepareAnalysisResultPlot,
  recalculateFitAnalysisResult,
  renameAnalysisResult,
  resolveAnalysisResultPlot,
} from "./analysisResultActions";
import { useApp } from "./useApp";

const spec: FitSpec = {
  model: "Linear", xKey: null, yKey: 0, params: [2, 1], errors: [0.1, 0.2],
  p0: [1, 0], fixed: [false, false], nPoints: 3, fittedAt: "2026-10-09T00:00:00Z",
};
const source: Dataset = {
  id: "source", name: "Line",
  data: { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["Y"], units: ["V"], metadata: {} },
  fitSpec: spec,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fitBands.mockResolvedValue({ yFit: [1, 3, 5], ciLo: [], ciHi: [], piLo: [], piHi: [], level: 0.95 });
  mocks.fitModel.mockResolvedValue({ params: [2, 1], errors: [0.1, 0.2], R2: 1, RMSE: 0, yFit: [1, 3, 5], exitFlag: 1 });
  mocks.listFitModels.mockResolvedValue({ models: [{ name: "Linear", paramNames: ["slope", "intercept"] }] });
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [source], activeId: "source", analysisResults: [fitAnalysisResult(source, spec)],
    staleFits: ["source"], history: [], future: [], xKey: null, yKeys: [0], fitOverlay: null,
  });
});

describe("curve-fit analysis result actions", () => {
  it("regenerates the fitted curve from the saved model without refitting", async () => {
    expect(await prepareAnalysisResultPlot("analysis-fit-source", 0)).toMatchObject({ dataset: { id: "source" } });
    expect(mocks.fitBands).toHaveBeenCalledWith(expect.objectContaining({
      model: "Linear", params: [2, 1], x: [0, 1, 2], n_points: 3,
    }));
    expect(mocks.fitModel).not.toHaveBeenCalled();
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "source", y: [1, 3, 5] });
  });

  it("derives plot channels from the live fit after an earlier column is removed", async () => {
    const oldSpec: FitSpec = { ...spec, xKey: 1, yKey: 2 };
    const oldSource: Dataset = {
      ...source, fitSpec: oldSpec,
      data: { ...source.data, values: [[9, 0, 1], [9, 1, 3], [9, 2, 5]], labels: ["Removed", "X", "Y"], units: ["", "s", "V"] },
    };
    const shifted: Dataset = {
      ...source, fitSpec: { ...spec, xKey: 0, yKey: 1 },
      data: { ...source.data, values: [[0, 1], [1, 3], [2, 5]], labels: ["X", "Y"], units: ["s", "V"] },
    };
    useApp.setState({ datasets: [shifted], analysisResults: [fitAnalysisResult(oldSource, oldSpec)] });
    expect(await prepareAnalysisResultPlot("analysis-fit-source", 0)).toMatchObject({ channels: [1], xChannel: 0 });
    expect(mocks.fitBands).toHaveBeenCalledWith(expect.objectContaining({ x: [0, 1, 2] }));
    expect(useApp.getState()).toMatchObject({ xKey: 0, yKeys: [1] });
  });

  it("refuses a malformed model-evaluation response without replacing the plot", async () => {
    mocks.fitBands.mockResolvedValueOnce({ yFit: [1], ciLo: [], ciHi: [], piLo: [], piHi: [], level: 0.95 });
    useApp.setState({ activeId: null, fitOverlay: null });
    expect(await prepareAnalysisResultPlot("analysis-fit-source", 0)).toBeNull();
    expect(useApp.getState().activeId).toBeNull();
    expect(useApp.getState().status).toContain("wrong number of fitted values");
  });

  it("never opens a source-only curve under the fitted-plot label when the saved fit is gone", async () => {
    useApp.setState({ datasets: [{ ...source, fitSpec: undefined }] });
    expect(await prepareAnalysisResultPlot("analysis-fit-source", 0)).toBeNull();
    expect(useApp.getState().status).toContain("saved fit is missing");
  });

  it("still resolves the recorded source curve for figure building after the fit is removed", async () => {
    useApp.setState({ datasets: [{ ...source, fitSpec: undefined }] });
    expect(await resolveAnalysisResultPlot("analysis-fit-source", 0, true)).toMatchObject({
      dataset: { id: "source" }, channels: [0], xChannel: null,
    });
    expect(mocks.fitBands).not.toHaveBeenCalled();
  });

  it("recalculates only this saved fit, clears staleness, and is undoable", async () => {
    useApp.setState({ fitOverlay: { datasetId: "source", y: [9, 9, 9] } });
    expect(await recalculateFitAnalysisResult("analysis-fit-source")).toBe(true);
    expect(mocks.fitModel).toHaveBeenCalledTimes(1);
    expect(useApp.getState().staleFits).toEqual([]);
    expect(useApp.getState().datasets[0].fitSpec).toMatchObject({ R2: 1, RMSE: 0, recomputedAt: expect.any(String) });
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "source", y: [1, 3, 5] });
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].fitSpec?.recomputedAt).toBeUndefined();
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("keeps a visible fit overlay through an unrelated result rename undo", () => {
    const overlay = { datasetId: "source", y: [1, 3, 5] };
    useApp.setState({ fitOverlay: overlay });
    renameAnalysisResult("analysis-fit-source", "Renamed fit");
    useApp.getState().undo();
    expect(useApp.getState().fitOverlay).toBe(overlay);
  });

  it("keeps the old fit stale when the backend omits finite parameters", async () => {
    mocks.fitModel.mockResolvedValueOnce({ params: [Number.NaN], exitFlag: 1 });
    expect(await recalculateFitAnalysisResult("analysis-fit-source")).toBe(false);
    expect(useApp.getState().staleFits).toEqual(["source"]);
    expect(useApp.getState().datasets[0].fitSpec).toBe(spec);
    expect(useApp.getState().history).toEqual([]);
    expect(useApp.getState().status).toContain("finite parameter values");
  });

  it("refuses to guess channels for a legacy fit recipe", async () => {
    const legacy = { ...source, fitSpec: { model: "Linear", params: [2, 1] } };
    useApp.setState({
      datasets: [legacy], analysisResults: [fitAnalysisResult(legacy, legacy.fitSpec)],
      staleFits: ["source"],
    });
    expect(await recalculateFitAnalysisResult("analysis-fit-source")).toBe(false);
    expect(mocks.fitModel).not.toHaveBeenCalled();
    expect(useApp.getState().staleFits).toEqual(["source"]);
    expect(useApp.getState().status).toContain("does not record exact X/Y channels");
  });

  it("exports the live parameter authority with model parameter names", async () => {
    expect(await exportAnalysisFitTable("analysis-fit-source")).toBe(true);
    expect(mocks.saveBlob).toHaveBeenCalledWith(expect.any(Blob), "Linear fit · Line-parameters.csv");
    const blob = mocks.saveBlob.mock.calls[0][0] as Blob;
    expect(await blob.text()).toContain("slope,2,0.1,false");
  });
});
