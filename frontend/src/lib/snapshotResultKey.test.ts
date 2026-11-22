import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { outlierScreeningAnalysisResult } from "./outlierScreeningAnalysisResult";
import type { OutlierScreeningRecipe, OutlierScreeningSnapshot } from "./outlierScreeningAnalysisResult";
import { outlierQuestion, multivariateQuestion, savedSnapshotKey, snapshotResultKey } from "./snapshotResultKey";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "s", name: "run.csv",
  data: { time: [0, 1, 2, 3], values: [[1], [2], [99], [3]], labels: ["signal"], units: ["V"], metadata: {} },
};
const recipe: OutlierScreeningRecipe = { col: 0, method: "mad", alpha: 0.05, k: 2, threshold: 3.5 };
const snapshot: OutlierScreeningSnapshot = {
  channelLabel: "signal",
  result: { method: "mad", data: {
    modified_z_scores: [0, 0.67, 65.4, 1], median: 2, mad: 1, scale_method: "MAD",
    threshold: 3.5, flagged_indices: [2], N: 4, excluded_indices: [], method: "modified z-score",
  } },
  flaggedRows: [{ rowIndex: 2, value: 99, score: 65.4 }], omittedRows: [], rosnerSteps: [],
};
const saved = (): AnalysisResult => outlierScreeningAnalysisResult("r", source, recipe, snapshot);

describe("snapshot result key", () => {
  it("a saved result occupies the key a new save of the same computation computes", () => {
    const result = saved();
    expect(savedSnapshotKey(result)).toBe(
      snapshotResultKey("outlier-screening", "s", result.sourceFingerprint!, outlierQuestion(recipe)),
    );
  });

  it("settings that do not change the question do not change the key", () => {
    expect(outlierQuestion({ ...recipe, alpha: 0.5, k: 9 })).toEqual(outlierQuestion(recipe));
    expect(outlierQuestion({ ...recipe, threshold: 4 })).not.toEqual(outlierQuestion(recipe));
    expect(outlierQuestion({ ...recipe, method: "grubbs", k: 1 })).toEqual(outlierQuestion({ ...recipe, method: "grubbs", k: 7 }));
    const mv = { columns: [0, 1], method: "pearson" as const, standardize: true, pcX: 0, pcY: 1 };
    expect(multivariateQuestion({ ...mv, pcX: 1, pcY: 0 })).toEqual(multivariateQuestion(mv));
  });

  it("a stale, fingerprint-less or unparseable result occupies no key", () => {
    expect(savedSnapshotKey({ ...saved(), stale: true })).toBeNull();
    const { sourceFingerprint: _drop, ...bare } = saved();
    expect(savedSnapshotKey(bare)).toBeNull();
    expect(savedSnapshotKey({ ...saved(), parameters: {} })).toBeNull();
  });

  it("statistical tests have no key (each Run is a new run)", () => {
    expect(savedSnapshotKey({ ...saved(), producer: { id: "statistical-test", label: "t", version: 1 } })).toBeNull();
  });
});
