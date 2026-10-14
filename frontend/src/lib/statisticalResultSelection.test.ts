import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "./analysisResult";
import { statisticalResultRowSelection } from "./statisticalResultSelection";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "source", name: "Measurements",
  data: {
    time: [0, 1, 2, 3], labels: ["value", "lot", "wafer"], units: ["", "", ""],
    values: [[10, 0, 0], [11, 0, 1], [12, 1, 0], [13, 1, 0]], metadata: {},
    cat_levels: { 1: ["A", "B"], 2: ["W1", "W2"] },
  },
};

function result(producer: string, title: string, columns: string[], row: (string | number | null)[], recipe = {}): AnalysisResult {
  return {
    version: 1, id: "result", name: "Result", producer: { id: producer, label: producer, version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [], scalarValues: {}, warnings: [],
    parameters: { recipe }, tables: [{ title, columns, rows: [row] }], createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("statisticalResultRowSelection", () => {
  it("keeps legacy zero-based Outlier rows while resolving one-based current rows and PCA rows", () => {
    expect(statisticalResultRowSelection(result("outlier-screening", "Flagged rows", ["source row"], [2]), source, 0, 0)?.rows).toEqual([2]);
    const current = result("outlier-screening", "Flagged rows", ["source row"], [3]);
    current.producer.version = 2;
    expect(statisticalResultRowSelection(current, source, 0, 0)?.rows).toEqual([2]);
    expect(statisticalResultRowSelection(result("multivariate-analysis", "PCA scores", ["source row"], [2]), source, 0, 0)?.rows).toEqual([1]);
  });

  it("maps a distribution level to every categorical source row", () => {
    const saved = result("distribution-analysis", "Summary by lot", ["level", "N"], ["B", 2], {
      col: 0, byCol: 1, fitDist: "none", compareOpen: false, percentileInput: 95,
    });
    expect(statisticalResultRowSelection(saved, source, 0, 0)?.rows).toEqual([2, 3]);
  });

  it("treats a literal All by-factor level as a group, not the ungrouped sentinel", () => {
    const grouped: Dataset = {
      ...source,
      data: {
        ...source.data,
        cat_levels: { ...source.data.cat_levels, 2: ["All", "Other"] },
      },
    };
    const saved = result("fit-y-by-x", "Group summaries",
      ["level", "group", "N", "mean", "sd"], ["All", "A", 1, 10, 0], {
        xCol: 1, yCol: 0, byCol: 2, order: 1, bandInterval: "confidence",
      });
    expect(statisticalResultRowSelection(saved, grouped, 0, 0)?.rows).toEqual([0]);
  });

  it("does not select excluded source rows that did not participate", () => {
    const saved = result("distribution-analysis", "Summary by lot", ["level", "N"], ["B", 1], {
      col: 0, byCol: 1, fitDist: "none", compareOpen: false, percentileInput: 95,
    });
    expect(statisticalResultRowSelection(saved, { ...source, excludedRows: [3] }, 0, 0)?.rows).toEqual([2]);
  });

  it("does not link grouped summaries to rows with a non-finite response", () => {
    const invalidResponse: Dataset = {
      ...source,
      data: { ...source.data, values: source.data.values.map((row, index) =>
        index === 3 ? [Number.NaN, row[1], row[2]] : row) },
    };
    const distribution = result("distribution-analysis", "Summary by lot", ["level", "N"], ["B", 1], {
      col: 0, byCol: 1, fitDist: "none", compareOpen: false, percentileInput: 95,
    });
    const fit = result("fit-y-by-x", "Group summaries", ["level", "group", "N", "mean", "sd"], ["All", "B", 1, 12, 0], {
      xCol: 1, yCol: 0, byCol: null, order: 1, bandInterval: "confidence",
    });
    const variability = result("variability-analysis", "Factor A summaries", ["lot", "N"], ["B", 1], {
      responseCol: 0, factorACol: 1, factorBCol: 2,
    });
    expect(statisticalResultRowSelection(distribution, invalidResponse, 0, 0)?.rows).toEqual([2]);
    expect(statisticalResultRowSelection(fit, invalidResponse, 0, 0)?.rows).toEqual([2]);
    expect(statisticalResultRowSelection(variability, invalidResponse, 0, 0)?.rows).toEqual([2]);
  });

  it("maps nested variability cells using their display labels", () => {
    const saved = result("variability-analysis", "Cell summaries", ["lot", "wafer", "N"], ["A", "W2", 1], {
      responseCol: 0, factorACol: 1, factorBCol: 2,
    });
    expect(statisticalResultRowSelection(saved, source, 0, 0)?.rows).toEqual([1]);
  });

  it("does not invent a relationship for summary-only tables", () => {
    expect(statisticalResultRowSelection(result("statistical-test", "Test", ["statistic"], [2]), source, 0, 0)).toBeNull();
  });
});
