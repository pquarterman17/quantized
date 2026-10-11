import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import {
  multivariateAnalysisResult, multivariateRecipe, multivariateSnapshotMatchesRecipe, sameMultivariateQuestion,
  type MultivariateRecipe, type MultivariateSnapshot,
} from "./multivariateAnalysisResult";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "source", name: "process.csv",
  data: {
    time: [0, 1, 2, 3], values: [[1, 10, 100], [2, 20, 200], [3, 30, 300], [4, 40, NaN]],
    labels: ["temperature", "pressure", "yield"], units: ["K", "Pa", "%"], metadata: { x_column_name: "run" },
  },
};
const recipe: MultivariateRecipe = { columns: [-1, 0, 2], method: "spearman", standardize: true, pcX: 0, pcY: 1 };
const snapshot: MultivariateSnapshot = {
  labels: ["run", "temperature", "yield"], sourceRows: [1, 2, 3], inputRows: 4,
  correlation: {
    r: [[1, 0.9, 0.8], [0.9, 1, 0.7], [0.8, 0.7, 1]],
    p: [[0, 0.01, 0.02], [0.01, 0, 0.03], [0.02, 0.03, 0]], N: 3, method: "spearman",
  },
  pca: {
    coeff: [[0.5, 0.1], [0.5, -0.1], [0.7, 0.9]], score: [[1, 0], [0, 1], [-1, -1]],
    latent: [2.5, 0.5], explained: [83.3, 16.7], cumulative: [83.3, 100],
    mu: [1, 2, 3], sigma: [1, 2, 3], singular: [2, 1],
  },
};

describe("multivariateAnalysisResult", () => {
  it("saves correlation, derived PCA scores, source-row identity, recipe, and freshness without embedding the source table", () => {
    const result = multivariateAnalysisResult("result", source, recipe, snapshot, "2026-10-10T00:00:00Z");
    expect(result).toMatchObject({
      producer: { id: "multivariate-analysis" }, sources: [{ datasetId: "source" }], outputs: [],
      parameters: { recipe }, sourceFingerprint: analysisDataFingerprint(source),
      selection: { channels: [{ index: 0, label: "temperature", unit: "K" }, { index: 2, label: "yield", unit: "%" }] },
      scalarValues: {
        N: 3, "Input rows": 4, "Rows omitted by listwise deletion": 1, Correlation: "spearman",
        "Correlation p-values": "two-sided t approximation", "PCA standardized": "yes",
        "PCA loading signs": "largest-magnitude loading positive",
      },
    });
    expect(result.tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Correlation coefficients", rows: expect.arrayContaining([["run", 1, 0.9, 0.8]]) }),
      expect.objectContaining({ title: "PCA component summary" }),
      expect.objectContaining({ title: "PCA loadings" }),
      expect.objectContaining({ title: "PCA scores", rows: [[1, 1, 0], [2, 0, 1], [3, -1, -1]] }),
    ]));
    expect(result.warnings).toContain("1 row was omitted by listwise deletion.");
    expect(multivariateRecipe(result, source)).toEqual(recipe);
    expect(JSON.stringify(result)).not.toContain('"values"');
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])))).toEqual([result]);
  });

  it("rejects malformed or source-incompatible saved questions", () => {
    const result = multivariateAnalysisResult("result", source, recipe, snapshot);
    expect(multivariateRecipe({ ...result, parameters: { recipe: { ...recipe, columns: [0, 0] } } })).toBeNull();
    expect(multivariateRecipe({ ...result, parameters: { recipe: { ...recipe, method: "kendall" } } })).toBeNull();
    expect(multivariateRecipe({ ...result, parameters: { recipe: { ...recipe, pcY: 3 } } })).toBeNull();
    expect(multivariateRecipe({ ...result, parameters: { recipe: { ...recipe, columns: [0, 9] } } }, source)).toBeNull();
    expect(multivariateRecipe({ ...result, producer: { id: "future", label: "Future", version: 1 } })).toBeNull();
    expect(sameMultivariateQuestion(recipe, { ...recipe, columns: [...recipe.columns] })).toBe(true);
    expect(sameMultivariateQuestion(recipe, { ...recipe, pcX: 1, pcY: 0 })).toBe(true);
    expect(sameMultivariateQuestion(recipe, { ...recipe, standardize: false })).toBe(false);
    expect(multivariateSnapshotMatchesRecipe(recipe, snapshot)).toBe(true);
    expect(multivariateSnapshotMatchesRecipe(recipe, {
      ...snapshot, correlation: { ...snapshot.correlation, method: "pearson" },
    })).toBe(false);
    expect(multivariateSnapshotMatchesRecipe(recipe, {
      ...snapshot, pca: { ...snapshot.pca, score: [[1], [2], [3]] },
    })).toBe(false);
  });

  it("discloses constant-variable scale fallback and undefined correlations", () => {
    const constantSource: Dataset = {
      ...source, data: { ...source.data, values: source.data.values.map((row) => [row[0], 7]) },
    };
    const result = multivariateAnalysisResult("constant", constantSource, {
      columns: [0, 1], method: "pearson", standardize: true, pcX: 0, pcY: 1,
    }, {
      labels: ["temperature", "pressure"], sourceRows: [1, 2, 3], inputRows: 3,
      correlation: { r: [[1, NaN], [NaN, NaN]], p: [[0, NaN], [NaN, NaN]], N: 3, method: "pearson" },
      pca: {
        coeff: [[1, 0], [0, 1]], score: [[-1, 0], [0, 0], [1, 0]], latent: [1, 0],
        explained: [100, 0], cumulative: [100, 100], mu: [2, 7], sigma: [1, 1], singular: [1, 0],
      },
    });
    expect(result.warnings).toContain(
      "Constant variable: pressure. PCA records a scale of 1 as a zero-variance fallback; correlations involving it are undefined.",
    );
    expect(result.tables?.find((table) => table.title === "Correlation coefficients")?.rows[1][1]).toBeNull();
  });

  it("bounds large PCA score output and discloses truncation", () => {
    const rows = Array.from({ length: 20_000 }, (_, index) => [index, -index]);
    const result = multivariateAnalysisResult("large", source, { ...recipe, columns: [0, 1] }, {
      ...snapshot, labels: ["temperature", "pressure"], sourceRows: rows.map((_, index) => index + 1),
      inputRows: rows.length, correlation: { ...snapshot.correlation, r: [[1, 0], [0, 1]], p: [[0, 1], [1, 0]], N: rows.length },
      pca: { ...snapshot.pca, coeff: [[1, 0], [0, 1]], score: rows, mu: [0, 0], sigma: [1, 1] },
    });
    const scores = result.tables?.find((table) => table.title === "PCA scores");
    expect(scores?.rows.length).toBeGreaterThan(0);
    expect(scores?.rows.length).toBeLessThan(rows.length);
    expect(result.warnings.some((warning) => warning.includes('"PCA scores" was saved with'))).toBe(true);
    expect(sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])))).toEqual([result]);
  });

  it("omits over-wide tables without materializing their rows", () => {
    const labels = Array.from({ length: 300 }, (_, index) => `v${index + 1}`);
    const result = multivariateAnalysisResult("wide", source, {
      columns: labels.map((_, index) => index), method: "pearson", standardize: false, pcX: 0, pcY: 1,
    }, {
      labels, sourceRows: [1], inputRows: 1,
      correlation: { r: [], p: [], N: 1, method: "pearson" },
      pca: { coeff: [], score: [], latent: [], explained: new Array(300).fill(0), cumulative: [],
        mu: [], sigma: [], singular: [] },
    });
    expect(result.tables?.some((table) => table.title === "Correlation coefficients")).toBe(false);
    expect(result.tables?.some((table) => table.title === "PCA loadings")).toBe(false);
    expect(result.tables?.some((table) => table.title === "PCA scores")).toBe(false);
    expect(result.warnings.filter((warning) => warning.includes("too wide"))).toHaveLength(4);
  });
});
