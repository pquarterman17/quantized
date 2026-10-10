import { describe, expect, it } from "vitest";

import type { NestedAnovaResponse, VarianceComponentsResponse, VariabilitySummaryResponse } from "./api";
import { sanitizeAnalysisResults } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import type { Dataset } from "./types";
import { variabilityAnalysisResult, variabilityRecipe, type VariabilitySnapshot } from "./variabilityAnalysisResult";

const source: Dataset = {
  id: "source", name: "wafers.csv",
  data: { time: [0, 1, 2, 3], values: [[0, 0, 2], [0, 1, 4], [1, 0, 6], [1, 1, 8]],
    labels: ["lot", "wafer", "measurement"], units: ["", "", "nm"], metadata: {} },
};
const anova: NestedAnovaResponse = {
  table: [
    { source: "A", SS: 16, df: 1, MS: 16, F: 4, p: 0.1 },
    { source: "B(A)", SS: 4, df: 2, MS: 2, F: null, p: null },
  ],
  a_levels: 2, b_per_a: [2, 2], n_per_cell: [[1, 1], [1, 1]], n_total: 4,
  grand_mean: 5, alpha: 0.05, a_tested_against: "B(A)", b_within_a_estimable: true,
  error_estimable: true, balanced: true,
};
const summary: VariabilitySummaryResponse = {
  cells: [
    { a_index: 0, b_index: 0, n: 1, mean: 2, sd: null },
    { a_index: 0, b_index: 1, n: 1, mean: 4, sd: null },
    { a_index: 1, b_index: 0, n: 1, mean: 6, sd: null },
    { a_index: 1, b_index: 1, n: 1, mean: 8, sd: null },
  ],
  a_groups: [{ a_index: 0, n: 2, mean: 3 }, { a_index: 1, n: 2, mean: 7 }],
  grand_mean: 5, grand_n: 4, a_levels: 2, balanced: true,
};
const varComp: VarianceComponentsResponse = {
  sigma2_A: 3, sigma2_B_within_A: 0, sigma2_error: 2,
  sigma2_A_raw: 3, sigma2_B_within_A_raw: -1, sigma2_error_raw: 2,
  pct_A: 60, pct_B_within_A: 0, pct_error: 40,
  clamped: { A: false, B_within_A: true, error: false }, n1_coefficient: 1, n2_coefficient: 2,
  ms_a: 16, ms_b: 2, ms_e: 2, balanced: true, method: "ANOVA/EMS",
};
const snapshot: VariabilitySnapshot = {
  responseLabel: "measurement", factorALabel: "lot", factorBLabel: "wafer",
  levelLabels: [{ aLabel: "lot A", bLabels: ["w1", "w2"] }, { aLabel: "lot B", bLabels: ["w1", "w2"] }],
  anova, summary, varComp, varCompNote: null,
};

describe("variabilityAnalysisResult", () => {
  it("saves labeled summaries, estimates, warnings, recipe, and freshness without raw observations", () => {
    const recipe = { responseCol: 2, factorACol: 0, factorBCol: 1 };
    const result = variabilityAnalysisResult("result", source, recipe, snapshot, "2026-10-10T00:00:00Z");
    expect(result).toMatchObject({
      producer: { id: "variability-analysis" }, sources: [{ datasetId: "source" }], outputs: [],
      parameters: { recipe }, sourceFingerprint: analysisDataFingerprint(source),
      selection: { channels: [{ index: 2, label: "measurement", unit: "nm" }, { index: 0 }, { index: 1 }] },
      scalarValues: { N: 4, "Grand mean": 5, "Variance method": "ANOVA/EMS", "n1 coefficient": 1,
        "B(A) estimable": "yes", "Error estimable": "yes" },
    });
    expect(result.tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Nested ANOVA" }),
      expect.objectContaining({ title: "Variance components", rows: expect.arrayContaining([["B(A)", 0, -1, 0, "yes"]]) }),
      expect.objectContaining({ title: "Cell summaries", rows: expect.arrayContaining([["lot A", "w1", 1, 2, null]]) }),
    ]));
    expect(result.warnings).toContain("Negative raw variance estimate for B(A) was clamped to zero.");
    expect(result.name).toBe("measurement by lot / wafer · wafers.csv");
    expect(variabilityRecipe(result, source)).toEqual(recipe);
    expect(JSON.stringify(result)).not.toContain('"values"');
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])))).toEqual([result]);
  });

  it("preserves a valid non-estimable result and rejects malformed saved questions", () => {
    const recipe = { responseCol: 2, factorACol: 0, factorBCol: 1 };
    const result = variabilityAnalysisResult("result", source, recipe, {
      ...snapshot, anova: { ...anova, b_within_a_estimable: false, error_estimable: false, balanced: false },
      varComp: null, varCompNote: "variance components are not estimable",
    });
    expect(result.tables?.some((table) => table.title === "Variance components")).toBe(false);
    expect(result.warnings).toContain("variance components are not estimable");
    expect(result.warnings).toContain("The B(A) component is not estimable for this design.");
    expect(result.warnings).toContain("The Error component is not estimable for this design.");
    expect(result.warnings).toContain("The nested design is unbalanced. The A test is approximate: the B(A) coefficient in E[MS_A] is not n1, and no Satterthwaite denominator-df correction is applied.");
    expect(variabilityRecipe({ ...result, parameters: { recipe: { ...recipe, factorACol: 2 } } })).toBeNull();
    expect(variabilityRecipe({ ...result, parameters: { recipe: { ...recipe, responseCol: 9 } } }, source)).toBeNull();
    expect(variabilityRecipe({ ...result, parameters: { recipe: { ...recipe, responseCol: 1.5 } } })).toBeNull();
    expect(variabilityRecipe({ ...result, producer: { id: "future", label: "Future", version: 1 } })).toBeNull();
  });

  it("bounds a pathological cell-summary table and discloses truncation", () => {
    const cells = Array.from({ length: 12_000 }, (_, index) => ({
      a_index: 0, b_index: index, n: 1, mean: index, sd: null,
    }));
    const result = variabilityAnalysisResult("large", source,
      { responseCol: 2, factorACol: 0, factorBCol: 1 }, {
        ...snapshot, varComp: null, varCompNote: null,
        levelLabels: [{ aLabel: "lot A", bLabels: cells.map((_, index) => `w${index}`) }],
        summary: { ...summary, cells },
      });
    expect(result.tables?.find((table) => table.title === "Cell summaries")?.rows).toHaveLength(10_000);
    expect(result.warnings).toContain('"Cell summaries" was saved with 10000 of 12000 rows.');
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])))).toEqual([result]);
  });
});
