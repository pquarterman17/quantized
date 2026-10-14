import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { createFigureDocument, sanitizeFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import {
  figureRowsForSourceRows,
  resolveStatisticalFigureLink,
  sourceRowsForFigureRows,
} from "./statisticalFigureLink";
import { statisticalResultFigureDrafts } from "./statisticalResultFigures";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "source", name: "Measurements",
  data: {
    time: [0, 1, 2, 3], labels: ["value", "lot"], units: ["", ""],
    values: [[0.5, 0], [1.5, 0], [2.5, 1], [3.5, 1]], metadata: {},
    cat_levels: { 1: ["A", "B"] },
  },
};

function distribution(): AnalysisResult {
  return {
    version: 1, id: "result", name: "Distribution",
    producer: { id: "distribution-analysis", label: "Distribution", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [], warnings: [],
    sourceFingerprint: analysisDataFingerprint(source), scalarValues: { Column: "value" },
    parameters: { recipe: { col: 0, byCol: null, fitDist: "none", compareOpen: false, percentileInput: 95 } },
    tables: [{ title: "Histogram", columns: ["bin left", "center", "bin right", "count"],
      rows: [[0, 1, 2, 2], [2, 3, 4, 2]] }],
    createdAt: "2026-10-13T00:00:00Z",
  };
}

function documentFor(result: AnalysisResult) {
  const draft = statisticalResultFigureDrafts(result)[0];
  const snapshot = { ...draft.data, metadata: { ...draft.data.metadata,
    sourceDatasetId: result.sources[0]?.datasetId ?? null,
    sourceFingerprint: result.sourceFingerprint ?? null,
  } };
  return createFigureDocument({
    id: "figure", name: draft.name, datasetId: null, view: draft.view ?? defaultPlotView(),
    mark: draft.mark, data: { mode: "frozen", snapshot },
  });
}

describe("statistical frozen-figure row links", () => {
  it("maps histogram bins to exact participating source rows in both directions", () => {
    const result = distribution();
    const link = resolveStatisticalFigureLink(documentFor(result), [source], "frozen:figure");
    expect(link?.rowsByFigureRow).toEqual([[0, 1], [2, 3]]);
    expect(sourceRowsForFigureRows(link!, [1])).toEqual([2, 3]);
    expect(figureRowsForSourceRows(link!, [1, 2])).toEqual([0, 1]);
  });

  it("keeps the frozen figure renderable but disables malformed saved links", () => {
    const result = distribution();
    const document = documentFor(result);
    document.data.snapshot!.metadata.analysisSourceLink = { kind: "histogram", responseColumn: 99, bins: [[0, 2], [2, 4]] };
    expect(resolveStatisticalFigureLink(document, [source], "frozen:figure")).toBeNull();
    expect(document.data.snapshot?.values).toEqual([[2], [2]]);
  });

  it("disables linking when the source analysis view is stale", () => {
    const result = distribution();
    const changedSource = { ...source, data: { ...source.data, values: source.data.values.map((row) => [...row]) } };
    changedSource.data.values[0][0] = 9;
    expect(resolveStatisticalFigureLink(documentFor(result), [changedSource], "frozen:figure")).toBeNull();
  });

  it("preserves its bounded link through a workspace JSON round trip", () => {
    const restored = sanitizeFigureDocument(JSON.parse(JSON.stringify(documentFor(distribution()))));
    expect(resolveStatisticalFigureLink(restored, [source], "frozen:restored")?.rowsByFigureRow)
      .toEqual([[0, 1], [2, 3]]);
  });

  it("maps saved group-mean bars to all source observations in that group", () => {
    const result: AnalysisResult = {
      version: 1, id: "fit", name: "Fit Y by X",
      producer: { id: "fit-y-by-x", label: "Fit Y by X", version: 1 },
      sources: [{ datasetId: source.id, role: "input" }], outputs: [], warnings: [],
      sourceFingerprint: analysisDataFingerprint(source),
      scalarValues: { Mode: "oneway", "X column": "lot", "Y column": "value" },
      parameters: { mode: "oneway", recipe: {
        xCol: 1, yCol: 0, byCol: null, order: 1, bandInterval: "confidence",
      } },
      tables: [{ title: "Group summaries", columns: ["level", "group", "N", "mean", "sd"],
        rows: [["All", "A", 2, 1, 0.7], ["All", "B", 2, 3, 0.7]] }],
      createdAt: "2026-10-13T00:00:00Z",
    };
    const link = resolveStatisticalFigureLink(documentFor(result), [source], "frozen:fit");
    expect(link?.rowsByFigureRow).toEqual([[0, 1], [2, 3]]);
  });
});
