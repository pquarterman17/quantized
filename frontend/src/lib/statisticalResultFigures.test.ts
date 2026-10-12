import { describe, expect, it } from "vitest";

import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import { statisticalResultFigureDrafts } from "./statisticalResultFigures";

function result(producer: string, tables: AnalysisResultTable[], extra: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    version: 1,
    id: "result-1",
    name: "Saved analysis",
    producer: { id: producer, label: producer, version: 1 },
    sources: [{ datasetId: "source-1", role: "input" }],
    outputs: [],
    tables,
    warnings: [],
    createdAt: "2026-10-11T00:00:00.000Z",
    ...extra,
  };
}

describe("statisticalResultFigureDrafts", () => {
  it("creates one honest histogram per saved Distribution table", () => {
    const saved = result("distribution-analysis", [
      { title: "Histogram · cold", columns: ["bin left", "center", "bin right", "count"], rows: [[0, 1, 2, 4], [2, 3, 4, 2]] },
      { title: "Histogram · hot", columns: ["bin left", "center", "bin right", "count"], rows: [[0, 1, 2, 3]] },
    ], { scalarValues: { Column: "Resistance" } });

    const drafts = statisticalResultFigureDrafts(saved);
    expect(drafts.map((draft) => draft.name)).toEqual(["Resistance distribution · cold", "Resistance distribution · hot"]);
    expect(drafts[0].mark).toBe("bar");
    expect(drafts[0].data.time).toEqual([1, 3]);
    expect(drafts[0].data.values).toEqual([[4], [2]]);
    expect(drafts[0].data.metadata).toMatchObject({
      analysisResultId: "result-1", analysisProducer: "distribution-analysis",
      analysisFigureKey: "distribution-histogram-0",
    });
    expect(drafts[0].view.xAxisLabel).toBe("Resistance");
  });

  it("creates per-level one-way means with SD bound only as an error channel", () => {
    const saved = result("fit-y-by-x", [{
      title: "Group summaries", columns: ["level", "group", "N", "mean", "sd"],
      rows: [["field 1", "A", 3, 10, 2], ["field 1", "B", 3, 20, 4], ["field 2", "A", 3, 30, null]],
    }], { parameters: { mode: "oneway" }, scalarValues: { "X column": "Treatment", "Y column": "Response" } });

    const drafts = statisticalResultFigureDrafts(saved);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].data.cat_levels).toEqual({ 0: ["A", "B"] });
    expect(drafts[0].view.yKeys).toEqual([1]);
    expect(drafts[0].errors).toEqual([{ channel: 2, target: 1, axis: "y", side: "both" }]);
    expect(drafts[1].data.values[0]).toEqual([0, 30]);
    expect(drafts[1].errors).toBeUndefined();
  });

  it("creates fitted curves from saved Fit Y by X values without inventing observations", () => {
    const saved = result("fit-y-by-x", [{
      title: "Fitted curve", columns: ["level", "X", "fitted Y"],
      rows: [["All", 0, 1], ["All", 1, 3], ["All", 2, null]],
    }, {
      title: "Regression band", columns: ["level", "X", "lower", "upper", "alpha"],
      rows: [["All", 0, 0.5, 1.5, 0.05], ["All", 1, 2, 4, 0.05]],
    }], { parameters: { mode: "bivariate" }, scalarValues: { "X column": "Dose", "Y column": "Signal" } });

    const [draft, band] = statisticalResultFigureDrafts(saved);
    expect(draft.mark).toBe("line");
    expect(draft.data.time).toEqual([0, 1]);
    expect(draft.data.values).toEqual([[1], [3]]);
    expect(draft.description).toContain("Observations remain in the source worksheet");
    expect(band.key).toBe("fit-y-by-x-band-0");
    expect(band.data.values).toEqual([[0.5, 1.5], [2, 4]]);
  });

  it("uses the saved PCA recipe axes and also creates explained variance", () => {
    const saved = result("multivariate-analysis", [
      { title: "PCA component summary", columns: ["component", "eigenvalue", "explained %", "cumulative %", "singular value"],
        rows: [["PC1", 3, 60, 60, 4], ["PC2", 2, 30, 90, 3], ["PC3", 1, 10, 100, 2]] },
      { title: "PCA scores", columns: ["source row", "PC1", "PC2", "PC3"],
        rows: [[1, 10, 20, 30], [2, 11, 21, 31], [3, null, 22, 32]] },
    ], { parameters: { recipe: { pcX: 2, pcY: 1 } } });

    const drafts = statisticalResultFigureDrafts(saved);
    expect(drafts.map((draft) => draft.key)).toEqual(["multivariate-scree", "multivariate-scores"]);
    expect(drafts[1].view.xAxisLabel).toBe("PC3");
    expect(drafts[1].view.yAxisLabel).toBe("PC2");
    expect(drafts[1].data.time).toEqual([30, 31, 32]);
    expect(drafts[1].data.values).toEqual([[20], [21], [22]]);
  });

  it("creates variability components and nested cell means with SD errors", () => {
    const saved = result("variability-analysis", [
      { title: "Variance components", columns: ["component", "variance", "raw estimate", "% total", "clamped"],
        rows: [["A", 4, 4, 80, "no"], ["Error", 1, 1, 20, "no"]] },
      { title: "Cell summaries", columns: ["Lot", "Wafer", "N", "mean", "sd"],
        rows: [["L1", "W1", 3, 9, 1], ["L1", "W2", 3, 11, 2]] },
    ], { scalarValues: { Response: "Thickness" } });

    const drafts = statisticalResultFigureDrafts(saved);
    expect(drafts.map((draft) => draft.key)).toEqual(["variability-components", "variability-cells"]);
    expect(drafts[1].data.cat_levels).toEqual({ 0: ["L1 / W1", "L1 / W2"] });
    expect(drafts[1].errors?.[0]).toMatchObject({ channel: 2, target: 1 });
  });

  it("omits an empty flagged-observation plot but preserves a Rosner sequence", () => {
    const saved = result("outlier-screening", [
      { title: "Flagged rows", columns: ["source row", "value", "statistic"], rows: [] },
      { title: "Rosner sequence", columns: ["step", "R", "critical lambda", "source row", "value", "exceeds"],
        rows: [[1, 4.2, 3.1, 9, 99, "yes"], [2, 2.1, 3, 5, 30, "no"]] },
    ]);

    const drafts = statisticalResultFigureDrafts(saved);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].key).toBe("outlier-rosner");
    expect(drafts[0].data.values).toEqual([[4.2, 3.1], [2.1, 3]]);
  });

  it("fails closed for unsupported producers and malformed or non-finite rows", () => {
    expect(statisticalResultFigureDrafts(result("statistical-tests", []))).toEqual([]);
    expect(statisticalResultFigureDrafts(result("distribution-analysis", [{
      title: "Histogram", columns: ["bin left", "center", "bin right", "count"],
      rows: [[0, Number.NaN, 2, 4], [0, 1, 2, null]],
    }]))).toEqual([]);
    expect(statisticalResultFigureDrafts(result("distribution-analysis", [{
      title: "Histogram", columns: ["center", "count", "bin left", "bin right"],
      rows: [[1, 4, 0, 2]],
    }]))).toEqual([]);
  });
});
