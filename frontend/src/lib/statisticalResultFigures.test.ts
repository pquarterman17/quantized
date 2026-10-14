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
    ], {
      scalarValues: { Column: "Resistance" },
      parameters: { recipe: { col: 2 } },
      selection: { datasetId: "source-1", channels: [
        { index: 0, label: "Other", unit: "wrong" },
        { index: 2, label: "Resistance", unit: "Ω" },
      ] },
    });

    const drafts = statisticalResultFigureDrafts(saved);
    expect(drafts.map((draft) => draft.name)).toEqual(["Resistance distribution · cold", "Resistance distribution · hot"]);
    expect(drafts[0].mark).toBe("bar");
    expect(drafts[0].data.time).toEqual([1, 3]);
    expect(drafts[0].data.values).toEqual([[4], [2]]);
    expect(drafts[0].data.metadata).toMatchObject({
      analysisResultId: "result-1", analysisProducer: "distribution-analysis",
      analysisFigureKey: "distribution-histogram-0",
    });
    // This malformed fixture names grouped tables but omits the grouping
    // column from its recipe. The figure remains useful, but linking must
    // fail closed rather than selecting rows from every group.
    expect(drafts[0].sourceLink).toBeUndefined();
    expect(drafts[0].view.xAxisLabel).toBe("Resistance (Ω)");
  });

  it("keeps blank and literal All grouping levels distinct from ungrouped results", () => {
    const histogram = result("distribution-analysis", [{
      title: "Histogram · ", columns: ["bin left", "center", "bin right", "count"],
      rows: [[0, 1, 2, 4]],
    }], { parameters: { recipe: { col: 0, byCol: 1 } } });
    const blank = statisticalResultFigureDrafts(histogram)[0];
    expect(blank.name).toBe("Value distribution · (blank)");
    expect(blank.data.metadata.analysisSourceLink).toMatchObject({
      kind: "histogram", level: { column: 1, label: "" },
    });

    const fit = result("fit-y-by-x", [{
      title: "Group summaries", columns: ["level", "group", "N", "mean", "sd"],
      rows: [["All", "A", 2, 3, 1]],
    }], {
      parameters: { mode: "oneway", recipe: { xCol: 0, yCol: 1, byCol: 2 } },
      scalarValues: { "X column": "Treatment", "Y column": "Response" },
    });
    const all = statisticalResultFigureDrafts(fit)[0];
    expect(all.name).toBe("Response by group · All");
    expect(all.data.metadata.analysisSourceLink).toMatchObject({
      kind: "match", rows: [{ levels: [[0, "A"], [2, "All"]] }],
    });

    const malformed = { ...fit, parameters: { mode: "oneway", recipe: { xCol: 0, yCol: 1 } } };
    expect(statisticalResultFigureDrafts(malformed)[0].sourceLink).toBeUndefined();

    const invalidIndex = { ...fit, parameters: { mode: "oneway", recipe: { xCol: 0, yCol: 1, byCol: -1 } } };
    expect(statisticalResultFigureDrafts(invalidIndex)[0].sourceLink).toBeUndefined();
  });

  it("creates per-level one-way means with SD bound only as an error channel", () => {
    const saved = result("fit-y-by-x", [{
      title: "Group summaries", columns: ["level", "group", "N", "mean", "sd"],
      rows: [["field 1", "A", 3, 10, 2], ["field 1", "B", 3, 20, 4], ["field 2", "A", 3, 30, null]],
    }], {
      parameters: { mode: "oneway", recipe: { xCol: 0, yCol: 1, byCol: null } },
      scalarValues: { "X column": "Treatment", "Y column": "Response" },
      selection: { datasetId: "source-1", channels: [
        { index: 0, label: "Treatment", unit: "" }, { index: 1, label: "Response", unit: "mV" },
      ] },
    });

    const drafts = statisticalResultFigureDrafts(saved);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].data.cat_levels).toEqual({ 0: ["A", "B"] });
    expect(drafts[0].view.yKeys).toEqual([1]);
    expect(drafts[0].view.yAxisLabel).toBe("Response (mV)");
    expect(drafts[0].errors).toEqual([{ channel: 2, target: 1, axis: "y", side: "both" }]);
    expect(drafts[1].data.values[0]).toEqual([0, 30]);
    expect(drafts[1].errors).toBeUndefined();
    expect(drafts[1].description).toContain("standard deviation was unavailable");
  });

  it("creates fitted curves from saved Fit Y by X values without inventing observations", () => {
    const saved = result("fit-y-by-x", [{
      title: "Fitted curve", columns: ["level", "X", "fitted Y"],
      rows: [["All", 0, 1], ["All", 1, 3], ["All", 2, null]],
    }, {
      title: "Regression band", columns: ["level", "X", "lower", "upper", "alpha"],
      rows: [["All", 0, 0.5, 1.5, 0.05], ["All", 1, 2, 4, 0.05]],
    }], {
      parameters: { mode: "bivariate", recipe: { xCol: 0, yCol: 1, byCol: null, bandInterval: "prediction" } },
      scalarValues: { "X column": "Dose", "Y column": "Signal" },
      selection: { datasetId: "source-1", channels: [
        { index: 0, label: "Dose", unit: "s" }, { index: 1, label: "Signal", unit: "V" },
      ] },
    });

    const [draft, band] = statisticalResultFigureDrafts(saved);
    expect(draft.mark).toBe("line");
    expect(draft.data.time).toEqual([0, 1]);
    expect(draft.data.values).toEqual([[1], [3]]);
    expect(draft.description).toContain("Observations remain in the source worksheet");
    expect(draft.data.metadata.analysisSourceLink).toEqual({
      kind: "match", responseColumn: 1,
      rows: [
        { levels: [] },
        { levels: [] },
      ],
    });
    expect(band.key).toBe("fit-y-by-x-band-0");
    expect(band.name).toBe("Signal 95% prediction interval");
    expect(band.view.xAxisLabel).toBe("Dose (s)");
    expect(band.view.yAxisLabel).toBe("Signal (V)");
    expect(band.data.values).toEqual([[1, 0.5, 1.5], [3, 2, 4]]);
    expect(band.description).toContain("Fitted curve plus lower and upper 95% prediction interval bounds");
    expect(band.data.metadata.analysisSourceLink).toMatchObject({
      kind: "match", responseColumn: 1,
      rows: [{ levels: [] }, { levels: [] }],
    });
  });

  it("does not interpolate a fitted line onto a different saved interval grid", () => {
    const saved = result("fit-y-by-x", [{
      title: "Fitted curve", columns: ["level", "X", "fitted Y"],
      rows: [["All", 0, 1], ["All", 1, 3]],
    }, {
      title: "Regression band", columns: ["level", "X", "lower", "upper", "alpha"],
      rows: [["All", 0, 0.5, 1.5, 0.05], ["All", 0.5, 1, 3, 0.05], ["All", 1, 2, 4, 0.05]],
    }], { parameters: { mode: "bivariate", recipe: { bandInterval: "confidence" } } });

    const band = statisticalResultFigureDrafts(saved)[1];
    expect(band.name).toBe("Y 95% confidence interval");
    expect(band.data.labels).toEqual(["Lower bound", "Upper bound"]);
    expect(band.description).toMatch(/^Lower and upper/);
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
    expect(drafts[1].view.xAxisLabel).toBe("PC3 (10.0%)");
    expect(drafts[1].view.yAxisLabel).toBe("PC2 (30.0%)");
    expect(drafts[1].data.time).toEqual([30, 31, 32]);
    expect(drafts[1].data.values).toEqual([[20], [21], [22]]);
    expect(drafts[1].data.metadata.analysisSourceLink).toEqual({ kind: "direct", rows: [0, 1, 2] });
  });

  it("creates variability components and nested cell means with SD errors", () => {
    const saved = result("variability-analysis", [
      { title: "Variance components", columns: ["component", "variance", "raw estimate", "% total", "clamped"],
        rows: [["A", 4, 4, 80, "no"], ["Error", 1, 1, 20, "no"]] },
      { title: "Cell summaries", columns: ["Lot", "Wafer", "N", "mean", "sd"],
        rows: [["L1", "W1", 3, 9, 1], ["L1", "W2", 3, 11, 2]] },
    ], {
      scalarValues: { Response: "Thickness" }, parameters: { recipe: { responseCol: 3 } },
      selection: { datasetId: "source-1", channels: [{ index: 3, label: "Thickness", unit: "nm" }] },
    });

    const drafts = statisticalResultFigureDrafts(saved);
    expect(drafts.map((draft) => draft.key)).toEqual(["variability-components", "variability-cells"]);
    expect(drafts[1].data.cat_levels).toEqual({ 0: ["L1 / W1", "L1 / W2"] });
    expect(drafts[1].errors?.[0]).toMatchObject({ channel: 2, target: 1 });
    expect(drafts[1].view.yAxisLabel).toBe("Thickness (nm)");
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

  it("uses the selected response unit on an outlier figure axis", () => {
    const saved = result("outlier-screening", [{
      title: "Flagged rows", columns: ["source row", "value", "statistic"], rows: [[7, 99, 4.2]],
    }], {
      scalarValues: { Channel: "Current" }, parameters: { recipe: { col: 4 } },
      selection: { datasetId: "source-1", channels: [{ index: 4, label: "Current", unit: "mA" }] },
    });
    const draft = statisticalResultFigureDrafts(saved)[0];
    expect(draft.name).toBe("Current flagged observations");
    expect(draft.view.yAxisLabel).toBe("Current (mA)");
    expect(draft.data.units).toEqual(["mA"]);
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
