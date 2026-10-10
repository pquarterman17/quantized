import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import {
  outlierScreeningAnalysisResult, outlierScreeningRecipe, sameOutlierScreeningQuestion,
  type OutlierScreeningRecipe, type OutlierScreeningSnapshot,
} from "./outlierScreeningAnalysisResult";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "source", name: "run.csv",
  data: { time: [0, 1, 2, 3], values: [[1], [2], [99], [Number.NaN]], labels: ["signal"], units: ["V"], metadata: {} },
};
const recipe: OutlierScreeningRecipe = { col: 0, method: "mad", alpha: 0.05, k: 2, threshold: 3.5 };
const snapshot: OutlierScreeningSnapshot = {
  channelLabel: "signal",
  result: { method: "mad", data: {
    modified_z_scores: [0, 0.67, 65.4, null], median: 2, mad: 1, scale_method: "MAD",
    threshold: 3.5, flagged_indices: [2], N: 3, excluded_indices: [3], method: "modified z-score",
  } },
  flaggedRows: [{ rowIndex: 2, value: 99, score: 65.4 }], omittedRows: [3], rosnerSteps: [],
};

describe("outlierScreeningAnalysisResult", () => {
  it("saves a compact, labeled audit snapshot without the raw score array", () => {
    const result = outlierScreeningAnalysisResult("result", source, recipe, snapshot, "2026-10-10T00:00:00Z");
    expect(result).toMatchObject({
      producer: { id: "outlier-screening" }, sources: [{ datasetId: "source" }], outputs: [],
      parameters: { recipe }, sourceFingerprint: analysisDataFingerprint(source),
      selection: { channels: [{ index: 0, label: "signal", unit: "V" }] },
      scalarValues: { N: 3, "Flagged rows": 1, "Non-finite rows omitted": 1, Median: 2, MAD: 1, Threshold: 3.5 },
    });
    expect(result.tables).toEqual([expect.objectContaining({
      title: "Flagged rows", rows: [[2, 99, 65.4]],
    })]);
    expect(result.warnings).toContain("Screening only: no rows were excluded or deleted.");
    expect(result.warnings).toContain("1 non-finite source row was omitted from the test: 3.");
    expect(JSON.stringify(result)).not.toContain("modified_z_scores");
    expect(outlierScreeningRecipe(result, source)).toEqual(recipe);
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])))).toEqual([result]);
  });

  it("keeps bounded Rosner steps and recognizes scientific equivalence", () => {
    const rosnerRecipe = { ...recipe, method: "rosner" as const };
    const result = outlierScreeningAnalysisResult("rosner", source, rosnerRecipe, {
      channelLabel: "signal", flaggedRows: [], omittedRows: [],
      result: { method: "rosner", data: {
        num_outliers: 0, flagged_indices: [], flagged_values: [], k: 2, alpha: 0.05, N: 4,
        excluded_indices: [], method: "generalized ESD", table: [],
      } },
      rosnerSteps: Array.from({ length: 12_000 }, (_, index) => ({
        step: index + 1, statistic: 1, critical: 2, rowIndex: index, value: index, exceeds: false,
      })),
    });
    expect(result.tables?.find((table) => table.title === "Rosner sequence")?.rows).toHaveLength(10_000);
    expect(result.warnings).toContain('"Rosner sequence" was saved with 10000 of 12000 rows.');
    expect(sameOutlierScreeningQuestion(rosnerRecipe, { ...rosnerRecipe, threshold: 9 })).toBe(true);
    expect(sameOutlierScreeningQuestion(recipe, { ...recipe, alpha: 0.01, k: 9 })).toBe(true);
    expect(sameOutlierScreeningQuestion(rosnerRecipe, { ...rosnerRecipe, k: 3 })).toBe(false);
  });

  it("rejects malformed or out-of-range saved questions", () => {
    const result = outlierScreeningAnalysisResult("result", source, recipe, snapshot);
    expect(outlierScreeningRecipe({ ...result, parameters: { recipe: { ...recipe, threshold: 0 } } })).toBeNull();
    expect(outlierScreeningRecipe({ ...result, parameters: { recipe: { ...recipe, method: "future" } } })).toBeNull();
    expect(outlierScreeningRecipe({ ...result, parameters: { recipe: { ...recipe, col: 4 } } }, source)).toBeNull();
    expect(outlierScreeningRecipe({ ...result, parameters: { recipe: { ...recipe, alpha: 1 } } })).toBeNull();
  });
});
