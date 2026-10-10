import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { fitYByXAnalysisResult, fitYByXRecipe, type FitYByXRecipe } from "./fitYByXAnalysisResult";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "source", name: "measurements.csv",
  data: {
    time: [0, 1, 2, 3], values: [[0, 10], [0, 12], [1, 20], [1, 22]],
    labels: ["group", "signal"], units: ["", "V"], metadata: {},
  },
  channelTypes: { 0: "nominal", 1: "continuous" },
};
const recipe: FitYByXRecipe = { xCol: 0, yCol: 1, byCol: null, order: 1, bandInterval: "confidence" };

describe("fitYByXAnalysisResult", () => {
  it("preserves an oneway question, summaries, tests, warnings, and source freshness", () => {
    const result = fitYByXAnalysisResult("result", source, recipe, {
      mode: "oneway", xLabel: "group", yLabel: "signal", byLabel: null, levels: [], totalLevels: 0,
      oneway: {
        groups: [{ label: "control", values: [10, 12] }, { label: "treated", values: [20, 22] }],
        anova: { fStat: 50, df1: 1, df2: 2, pValue: 0.02, reject: true },
        levene: { p: 0.8 }, tukey: null,
        recommend: { recommendation: "One-way ANOVA", endpoint: "/api/stats/anova", parametric: true,
          n_groups: 2, paired: false, checks: { alpha: 0.05, shapiro_p: [0.5, 0.6] }, reasons: [] },
        failed: { tukey: "service unavailable" },
      },
    }, "2026-10-10T00:00:00Z");
    expect(result).toMatchObject({
      producer: { id: "fit-y-by-x" }, sources: [{ datasetId: "source" }], outputs: [],
      sourceFingerprint: analysisDataFingerprint(source), parameters: { recipe, mode: "oneway" },
      selection: { channels: [{ index: 0, label: "group" }, { index: 1, label: "signal", unit: "V" }] },
    });
    expect(result.tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Oneway tests", rows: [["All", 50, 1, 2, 0.02, "yes", 0.8, "One-way ANOVA"]] }),
      expect.objectContaining({ title: "Group summaries", rows: [["All", "control", 2, 11, expect.any(Number)], ["All", "treated", 2, 21, expect.any(Number)]] }),
    ]));
    expect(result.warnings).toContain("tukey failed: service unavailable");
    expect(fitYByXRecipe(result, source)).toEqual(recipe);
    expect(JSON.stringify(result)).not.toContain('"values":[10,12]');
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])))).toEqual([result]);
  });

  it("consolidates By-level contingency cells and records failed levels", () => {
    const result = fitYByXAnalysisResult("by", source, { ...recipe, byCol: 0, xCol: -1 }, {
      mode: "contingency", xLabel: "condition", yLabel: "outcome", byLabel: "batch",
      levels: [{
        label: "A", n: 12, error: null,
        contingency: { rowLabels: ["yes", "no"], colLabels: ["pass", "fail"], table: [[4, 2], [1, 5]],
          chiSquare: { n: 12, chi2: 3, dof: 1, p_value: 0.08, cramers_v: 0.5, expected: [[2.5, 3.5], [2.5, 3.5]] },
          fisher: { odds_ratio: 10, p_value: 0.06 } },
      }, { label: "B", n: 1, error: "not enough data (n=1)" }],
      totalLevels: 3,
    });
    expect(result.tables?.[0]).toMatchObject({ title: "Contingency tests", rows: [["A", 12, 3, 1, 0.08, 0.5, 10, 0.06]] });
    expect(result.tables?.[1].rows).toHaveLength(4);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "Only 2 of 3 By levels were saved.", "B: not enough data (n=1)",
    ]));
  });

  it("rejects malformed, colliding, out-of-range, and future recipes", () => {
    const result = fitYByXAnalysisResult("result", source, recipe, {
      mode: "bivariate", xLabel: "x", yLabel: "y", byLabel: null, levels: [], totalLevels: 0,
      bivariate: { x: [1, 2, 3], y: [2, 4, 6], order: 1,
        regression: { N: 3, coeffs: [0, 2], se: [0.1, 0.2], yFit: [2, 4, 6], R2: 1, fPvalue: 0 },
        band: { x: [1, 2], ciLo: [1.8, 3.8], ciHi: [2.2, 4.2], alpha: 0.05, interval: "confidence" } },
    });
    expect(result.tables?.map((table) => table.title)).toEqual([
      "Regression summary", "Regression coefficients", "Fitted curve", "Regression band",
    ]);
    expect(result.tables?.[2]).toMatchObject({ columns: ["level", "X", "fitted Y"] });
    expect(result.tables?.[2].rows).toHaveLength(128);
    expect(result.tables?.[2].rows[0]).toEqual(["All", 1, 2]);
    expect(result.tables?.[2].rows.at(-1)).toEqual(["All", 3, 6]);
    expect(result.tables?.some((table) => table.columns.includes("Y"))).toBe(false);
    expect(fitYByXRecipe({ ...result, parameters: { recipe: { ...recipe, xCol: 1, yCol: 1 } } })).toBeNull();
    expect(fitYByXRecipe({ ...result, parameters: { recipe: { ...recipe, order: 4 } } })).toBeNull();
    expect(fitYByXRecipe({ ...result, parameters: { recipe: { ...recipe, bandInterval: "future" } } })).toBeNull();
    expect(fitYByXRecipe({ ...result, parameters: { recipe: { ...recipe, yCol: 7 } } }, source)).toBeNull();

    const overflow = fitYByXAnalysisResult("overflow", source, recipe, {
      mode: "bivariate", xLabel: "x", yLabel: "y", byLabel: null, levels: [], totalLevels: 0,
      bivariate: { x: [1e308, 1e308], y: [1, 2], order: 1,
        regression: { N: 2, coeffs: [0, 2], se: [0, 0], R2: 1, fPvalue: 0 }, band: null },
    });
    expect(overflow.tables?.find((table) => table.title === "Fitted curve")?.rows).toEqual([["All", 1e308, null]]);
    expect(overflow.warnings).toContain("non-finite fitted-curve values were saved as unavailable.");
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([overflow])))).toEqual([overflow]);
  });

  it("bounds a large Tukey table with an explicit row-count warning", () => {
    const manyGroups = Array.from({ length: 30 }, (_, index) => ({ label: `g${index}`, values: [index, index + 1] }));
    const pairs = manyGroups.flatMap((_, i) => manyGroups.slice(i + 1).map((__, offset) => ({
      i, j: i + offset + 1, diff: offset + 1, p: 0.5, ciLow: 0, ciHigh: 1, significant: false,
    })));
    const levels = Array.from({ length: 30 }, (_, index) => ({
      label: `level ${index}`, n: 60, error: null,
      oneway: {
        groups: manyGroups, anova: { fStat: 1, df1: 29, df2: 30, pValue: 0.5, reject: false },
        levene: null, recommend: null, tukey: { pairs },
      },
    }));
    const result = fitYByXAnalysisResult("large", {
      ...source,
      data: { ...source.data, labels: ["group", "signal", "batch"], units: ["", "V", ""] },
    }, { ...recipe, byCol: 2 }, {
      mode: "oneway", xLabel: "group", yLabel: "signal", byLabel: "batch", levels, totalLevels: 30,
    });
    const tukey = result.tables?.find((table) => table.title === "Tukey HSD");
    expect(tukey?.rows).toHaveLength(10_000);
    expect(result.warnings).toContain('"Tukey HSD" was saved with 10000 of 13050 rows.');
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])))).toEqual([result]);
  });
});
