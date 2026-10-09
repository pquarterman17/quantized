import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { fitAnalysisResult, fitResultId, migrateFitAnalysisResults } from "./fitAnalysisResult";
import type { Dataset, FitSpec } from "./types";

const dataset = (spec?: FitSpec): Dataset => ({
  id: "trace", name: "Trace",
  data: { time: [0, 1], values: [[0, 2], [1, 4]], labels: ["X", "Y"], units: ["s", "V"], metadata: {} },
  ...(spec ? { fitSpec: spec } : {}),
});

describe("curve-fit analysis result adapter", () => {
  it("points at the live FitSpec authority without copying scientific values", () => {
    const spec: FitSpec = { model: "Linear", xKey: 0, yKey: 1, params: [2, 0], fittedAt: "2026-10-09T00:00:00Z" };
    const result = fitAnalysisResult(dataset(spec), spec);
    expect(result).toMatchObject({
      id: fitResultId("trace"),
      name: "Linear fit · Trace",
      settingsRef: { datasetId: "trace", field: "fitSpec" },
      selection: { channels: [{ index: 1, label: "Y", unit: "V" }] },
      plotBindings: [{ datasetId: "trace", channels: [1], xChannel: 0 }],
      createdAt: "2026-10-09T00:00:00Z",
    });
    expect(result).not.toHaveProperty("scalarValues");
    expect(JSON.stringify(result)).not.toContain('"params"');
  });

  it("fails honestly when a legacy fit does not identify one Y channel", () => {
    const result = fitAnalysisResult(dataset(), { model: "Linear" }, "created");
    expect(result.plotBindings).toBeUndefined();
    expect(result.warnings).toEqual(expect.arrayContaining([
      "This legacy fit does not include fitted parameter values.",
      "The fitted Y channel is not recorded unambiguously.",
    ]));
  });

  it("does not offer a fitted plot when a legacy fit omits its X binding", () => {
    const result = fitAnalysisResult(dataset(), { model: "Linear", yKey: 1, params: [2, 0] }, "created");
    expect(result.selection?.channels[0].index).toBe(1);
    expect(result.plotBindings).toBeUndefined();
    expect(result.warnings).toContain("The fitted X axis is not recorded unambiguously.");
  });

  it("migrates once while preserving an existing renamed result", () => {
    const spec: FitSpec = { model: "Linear", xKey: 0, yKey: 1, params: [2, 0] };
    const first = migrateFitAnalysisResults([dataset(spec)], [], "created");
    const renamed: AnalysisResult = { ...first[0], name: "Reviewed fit", notes: "keep" };
    expect(migrateFitAnalysisResults([dataset(spec)], [renamed], "later")).toEqual([renamed]);
  });

  it("does not mistake a multi-source/global fit for this dataset's saved fit", () => {
    const spec: FitSpec = { model: "Linear", yKey: 1, params: [2, 0] };
    const global: AnalysisResult = {
      ...fitAnalysisResult(dataset(spec), spec, "created"),
      id: "global", settingsRef: undefined,
      sources: [{ datasetId: "trace", role: "input" }, { datasetId: "other", role: "input" }],
    };
    expect(migrateFitAnalysisResults([dataset(spec)], [global], "later")).toHaveLength(2);
  });

  it("records a later full re-fit as an update while preserving result creation", () => {
    const result = fitAnalysisResult(
      dataset({ model: "Linear", yKey: 1, params: [3], fittedAt: "later" }),
      { model: "Linear", yKey: 1, params: [3], fittedAt: "later" },
      "created",
    );
    expect(result).toMatchObject({ createdAt: "created", updatedAt: "later" });
  });
});
