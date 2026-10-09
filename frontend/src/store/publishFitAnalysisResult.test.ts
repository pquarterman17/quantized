import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset, FitSpec } from "../lib/types";
import { publishFitAnalysisResult } from "./publishFitAnalysisResult";
import { useApp } from "./useApp";

const fit = (params: number[], model = "Linear", fittedAt = "2026-10-09T00:00:00.000Z"): FitSpec => ({
  model, xKey: null, yKey: 0, params, fittedAt,
});

const dataset = (fitSpec: FitSpec): Dataset => ({
  id: "source", name: "Trace", fitSpec,
  data: { time: [0, 1], values: [[1], [3]], labels: ["signal"], units: ["V"], metadata: {} },
});

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [dataset(fit([2, 1]))], analysisResults: [], staleFits: ["source"] });
});

describe("publishFitAnalysisResult", () => {
  it("creates one linked result and clears fit staleness", () => {
    publishFitAnalysisResult("source");
    expect(useApp.getState().analysisResults).toEqual([
      expect.objectContaining({
        id: "analysis-fit-source",
        name: "Linear fit · Trace",
        settingsRef: { datasetId: "source", field: "fitSpec" },
      }),
    ]);
    expect(useApp.getState().staleFits).toEqual([]);
  });

  it("refreshes in place while preserving the user's identity and notes", () => {
    publishFitAnalysisResult("source");
    const original = useApp.getState().analysisResults[0];
    useApp.setState({
      analysisResults: [{ ...original, id: "kept-id", name: "Reviewed line", notes: "accepted" }],
      datasets: [dataset(fit([4, 2], "Quadratic", "2026-10-09T01:00:00.000Z"))],
      staleFits: ["source"],
    });

    publishFitAnalysisResult("source");

    expect(useApp.getState().analysisResults).toEqual([
      expect.objectContaining({
        id: "kept-id", name: "Reviewed line", notes: "accepted",
        createdAt: original.createdAt,
        updatedAt: "2026-10-09T01:00:00.000Z",
        settingsRef: { datasetId: "source", field: "fitSpec" },
      }),
    ]);
    expect(useApp.getState().analysisResults[0].name).not.toContain("Quadratic");
    expect(useApp.getState().staleFits).toEqual([]);
  });

  it("does nothing for a missing dataset or a dataset without a saved fit", () => {
    publishFitAnalysisResult("missing");
    useApp.setState({ datasets: [{ ...dataset(fit([2, 1])), fitSpec: undefined }] });
    publishFitAnalysisResult("source");
    expect(useApp.getState().analysisResults).toEqual([]);
    expect(useApp.getState().staleFits).toEqual(["source"]);
  });
});
