import { describe, expect, it } from "vitest";

import type { PeakTable } from "./peakTable";
import { migratePeakAnalysisResults, peakAnalysisResult, peakResultId } from "./peakAnalysisResult";
import type { Dataset } from "./types";

const dataset: Dataset = {
  id: "sample",
  name: "film.xrdml",
  data: { time: [10, 20], values: [[1, 4], [2, 8]], labels: ["counts", "background"], units: ["cps", "cps"], metadata: {} },
};
const table: PeakTable = {
  version: 1,
  peaks: [],
  provenance: {
    datasetId: "sample", datasetName: "film.xrdml", method: "simultaneous", model: "Gaussian",
    bgDegree: 1, linkMode: "None", constrain: false, bgCoeffs: [], R2: 0.99, rmse: 0.1,
    wavelengthA: 1.5406, xLabel: "2Theta", xUnit: "deg", fingerprint: "fp", fittedAt: "2026-10-08T00:00:00Z",
  },
};

describe("peakAnalysisResult", () => {
  it("references the source peak table without copying scientific values", () => {
    const result = peakAnalysisResult(dataset, table, 0);
    expect(result).toMatchObject({
      id: peakResultId("sample"),
      producer: { id: "peak-analysis" },
      sources: [{ datasetId: "sample" }],
      outputs: [],
      settingsRef: { datasetId: "sample", field: "peakTable" },
      plotBindings: [{ datasetId: "sample", channels: [0] }],
    });
    expect(result).not.toHaveProperty("scalarValues");
    expect(result).not.toHaveProperty("tableRefs");
  });

  it("does not guess a Y channel while migrating a multi-channel legacy table", () => {
    const [result] = migratePeakAnalysisResults([{ ...dataset, peakTable: table }], []);
    expect(result.plotBindings).toBeUndefined();
    expect(result.selection).toBeUndefined();
  });

  it("records an explicit alternate X column for exact plot reopening", () => {
    const result = peakAnalysisResult(dataset, table, 0, 1);
    expect(result.plotBindings).toEqual([{ datasetId: "sample", channels: [0], xChannel: 1 }]);
  });

  it("is idempotent when the catalog already contains that dataset's result", () => {
    const existing = peakAnalysisResult(dataset, table, 1);
    expect(migratePeakAnalysisResults([{ ...dataset, peakTable: table }], [existing])).toEqual([existing]);
  });

  it("does not duplicate a peak result that already links the dataset under a legacy id", () => {
    const existing = { ...peakAnalysisResult(dataset, table, 1), id: "legacy-peak-result" };
    expect(migratePeakAnalysisResults([{ ...dataset, peakTable: table }], [existing])).toEqual([existing]);
  });
});
