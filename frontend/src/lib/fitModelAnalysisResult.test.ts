import { describe, expect, it } from "vitest";

import type { FitModelResponse } from "./api/statsModel";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { fitModelAnalysisResult, fitModelRecipe, fitModelResultTables, type FitModelSnapshot } from "./fitModelAnalysisResult";
import { hasResultBook } from "./resultBook";
import { fitModelQuestion, savedSnapshotKey, snapshotResultKey } from "./snapshotResultKey";
import type { Dataset } from "./types";

const SOURCE: Dataset = {
  id: "d1", name: "growth.csv",
  data: { time: [0, 1, 2, 3], values: [[0, 1], [1, 2], [0, 3], [1, 5]], labels: ["sub", "y"], units: ["", "nm"], metadata: {} },
};

const FIT: FitModelResponse = {
  response: "y", n: 3, n_dropped_missing: 1,
  summary: { r2: 0.9, adj_r2: 0.8, rmse: 0.5, mean_response: 2.7, n: 3 },
  anova: [
    { source: "Model", df: 1, ss: 4, ms: 4, f: 16, p: 0.15 },
    { source: "Error", df: 1, ss: 0.25, ms: 0.25, f: null, p: null },
    { source: "C. Total", df: 2, ss: 4.25, ms: null, f: null, p: null },
  ],
  parameter_estimates: [
    { term: "Intercept", estimate: 2.5, se: 0.3, t: 8.3, p: 0.07, lower: -1, upper: 6 },
    { term: "sub[0]", estimate: -1, se: 0.3, t: -3.3, p: 0.18, lower: -5, upper: 3 },
  ],
  effect_tests: [{ effect: "sub", nparm: 1, df: 1, ss: 4, f: 16, p: 0.15 }],
  ls_means: [{ effect: "sub", factors: ["sub"], rows: [
    { levels: ["0"], ls_mean: 1.5, se: 0.4, mean: 1.5, n: 2 }, { levels: ["1"], ls_mean: 3.5, se: 0.5, mean: 3.5, n: 1 }] }],
  predicted: [1.5, 3.5, 1.5, null], residual: [-0.5, -1.5, 1.5, null],
  alpha: 0.05, center_polynomials: true,
  model: { response: "y", factors: [{ name: "sub", kind: "nominal", levels: ["0", "1"] }], terms: [["sub"]],
    center_polynomials: true, parameters: ["Intercept", "sub[0]"], coefficients: [2.5, -1],
    covariance: [[0.09, 0], [0, 0.09]], df_error: 1, rmse: 0.5 },
};

const SNAP: FitModelSnapshot = { responseLabel: "y", termLabels: ["sub"], rowIds: [0, 1, 3, 4], fit: FIT };
const RECIPE = { responseCol: 1, terms: [[0]], kinds: { 0: "nominal" as const }, center: true };

describe("Fit Model result", () => {
  it("saves JMP-titled tables in book order, LS means per nominal effect, residual rows keyed to worksheet rows", () => {
    const tables = fitModelResultTables(SNAP);
    expect(tables.map((t) => t.title)).toEqual(["Summary of fit", "Analysis of variance", "Effect tests",
      "Parameter estimates", "Least squares means: sub", "Predicted and residuals"]);
    expect(tables[3]!.columns.slice(-2)).toEqual(["Lower 95%", "Upper 95%"]);
    // dropped row (null) skipped; worksheet row numbers are 1-based originals
    expect(tables[5]!.rows).toEqual([[1, 1, 1.5, -0.5], [2, 2, 3.5, -1.5], [4, 3, 1.5, 1.5]]);
  });

  it("builds an envelope that round-trips its recipe, keeps the model for prediction and keys by value", () => {
    const result = fitModelAnalysisResult("r1", SOURCE, RECIPE, SNAP, "2026-11-24T00:00:00Z");
    expect(result.producer).toEqual({ id: "fit-model", label: "Fit Model", version: 1 });
    expect(result.sourceFingerprint).toBe(analysisDataFingerprint(SOURCE));
    expect(fitModelRecipe(result, SOURCE)).toEqual(RECIPE);
    expect((result.parameters?.model as { coefficients: number[] }).coefficients).toEqual([2.5, -1]);
    expect(result.warnings[0]).toMatch(/1 row\(s\) with a missing/);
    expect(hasResultBook(result)).toBe(true);
    expect(savedSnapshotKey(result)).toBe(snapshotResultKey("fit-model", "d1", result.sourceFingerprint!, fitModelQuestion(RECIPE)));
  });

  it("the question is order-free in a term but not in the model", () => {
    const a = fitModelQuestion({ ...RECIPE, terms: [[0, 1]], kinds: { 0: "nominal", 1: "continuous" } });
    const b = fitModelQuestion({ ...RECIPE, terms: [[1, 0]], kinds: { 1: "continuous", 0: "nominal" } });
    expect(a).toEqual(b);
    expect(fitModelQuestion({ ...RECIPE, center: false })).not.toEqual(fitModelQuestion(RECIPE));
  });

  it("fails closed on a recipe that does not parse or names a missing column", () => {
    const result = fitModelAnalysisResult("r1", SOURCE, { ...RECIPE, terms: [[5]], kinds: { 5: "continuous" } }, SNAP);
    expect(fitModelRecipe(result, SOURCE)).toBeNull();
    expect(fitModelRecipe({ ...result, parameters: { recipe: { responseCol: 1, terms: [], kinds: {}, center: true } } })).toBeNull();
  });
});
