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
  it("resolves zero-based outlier and one-based PCA source rows", () => {
    expect(statisticalResultRowSelection(result("outlier-screening", "Flagged rows", ["source row"], [2]), source, 0, 0)?.rows).toEqual([2]);
    expect(statisticalResultRowSelection(result("multivariate-analysis", "PCA scores", ["source row"], [2]), source, 0, 0)?.rows).toEqual([1]);
  });

  it("maps a distribution level to every categorical source row", () => {
    const saved = result("distribution-analysis", "Summary by lot", ["level", "N"], ["B", 2], {
      col: 0, byCol: 1, fitDist: "none", compareOpen: false, percentileInput: 95,
    });
    expect(statisticalResultRowSelection(saved, source, 0, 0)?.rows).toEqual([2, 3]);
  });

  it("does not select excluded source rows that did not participate", () => {
    const saved = result("distribution-analysis", "Summary by lot", ["level", "N"], ["B", 1], {
      col: 0, byCol: 1, fitDist: "none", compareOpen: false, percentileInput: 95,
    });
    expect(statisticalResultRowSelection(saved, { ...source, excludedRows: [3] }, 0, 0)?.rows).toEqual([2]);
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
