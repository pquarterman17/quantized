import { describe, expect, it } from "vitest";

import {
  createFigureDocument,
  deserializeFigureDocument,
  FIGURE_DOCUMENT_SCHEMA,
  FIGURE_DOCUMENT_VERSION,
  figureDocumentVersion,
  figureDocumentToPlotView,
  sanitizeFigureDocument,
  serializeFigureDocument,
  updateFigureDocumentFromPlotView,
} from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { DataStruct } from "./types";

const snapshot: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["signal"],
  units: ["V"],
  metadata: {},
};

describe("FigureDocument v1", () => {
  it("separates data bindings from visual state and preserves rich error roles", () => {
    const document = createFigureDocument({
      id: "figure-1",
      name: "Transfer curve",
      datasetId: "dataset-1",
      view: {
        ...defaultPlotView(),
        xKey: 0,
        yKeys: [1],
        y2Keys: [2],
        errKeys: { 1: 3 },
        plotTitle: "Device A",
      },
      mark: "scatter",
      groupKey: 4,
      facetKey: 5,
      axisBreaks: { x: [[2, 3]] },
      errors: [
        { channel: 3, target: 1, axis: "y", side: "+" },
        { channel: 4, target: 1, axis: "y", side: "-" },
      ],
    });

    expect(document).toMatchObject({
      schema: FIGURE_DOCUMENT_SCHEMA,
      version: FIGURE_DOCUMENT_VERSION,
      id: "figure-1",
      bindings: {
        datasetId: "dataset-1",
        xKey: 0,
        yKeys: [1],
        y2Keys: [2],
        groupKey: 4,
        facetKey: 5,
      },
      plot: {
        mark: "scatter",
        view: { plotTitle: "Device A" },
        axisBreaks: { x: [[2, 3]], y: [], y2: [] },
      },
    });
    expect(document.bindings.errors.map(({ side }) => side)).toEqual(["+", "-"]);
    expect(document.plot.view).not.toHaveProperty("xKey");
    expect(document.plot.view).not.toHaveProperty("errKeys");
  });

  it("projects legacy symmetric Y errors without losing them", () => {
    const document = createFigureDocument({
      id: "figure-2",
      name: "Legacy",
      datasetId: "dataset-1",
      view: { ...defaultPlotView(), errKeys: { 2: 7 } },
    });

    expect(document.bindings.errors).toEqual([
      { target: 2, channel: 7, axis: "y", side: "both" },
    ]);
  });

  it("preserves null automatic-channel selection instead of turning it into no channels", () => {
    const document = createFigureDocument({
      id: "figure-auto",
      name: "Automatic channels",
      datasetId: "dataset-1",
      view: defaultPlotView(),
    });

    expect(document.bindings.yKeys).toBeNull();
    expect(document.bindings.y2Keys).toBeNull();
    expect(figureDocumentToPlotView(document).yKeys).toBeNull();
  });

  it("round-trips as plain versioned JSON", () => {
    const document = createFigureDocument({
      id: "figure-3",
      name: "Frozen",
      datasetId: null,
      view: defaultPlotView(),
      data: { mode: "frozen", snapshot },
      output: { format: "png", dpi: 600 },
    });

    const restored: unknown = JSON.parse(JSON.stringify(document));
    expect(restored).toEqual(document);
    expect(figureDocumentVersion(restored)).toBe(1);
    expect(figureDocumentVersion({ ...document, version: 2 })).toBe(2);
    expect(figureDocumentVersion({ version: 1 })).toBeNull();
    expect(deserializeFigureDocument(serializeFigureDocument(document))).toEqual(document);
  });

  it("round-trips a customized view without sharing mutable state", () => {
    const source = {
      ...defaultPlotView(),
      xKey: 0,
      yKeys: [1, 2],
      y2Keys: [2],
      errKeys: { 1: 3 },
      annotations: [{ id: "a1", x: 1, y: 2, text: "peak", frame: { pad: 4 } }],
      shapes: [{ id: "s1", kind: "rect" as const, x1: 0, y1: 0, x2: 1, y2: 2 }],
      seriesStyles: { 1: { color: "#123456", width: 3 } },
      seriesOrder: [2, 1],
    };
    const document = createFigureDocument({
      id: "figure-rich",
      name: "Rich",
      datasetId: "dataset-1",
      view: source,
      axisBreaks: { x: [[3, 4]] },
    });
    const restored = figureDocumentToPlotView(document);

    expect(restored).toEqual(source);
    source.annotations[0].text = "mutated source";
    restored.seriesStyles[1].color = "#ffffff";
    expect(document.plot.view.annotations[0].text).toBe("peak");
    expect(document.plot.view.seriesStyles[1].color).toBe("#123456");
  });

  it("sanitizes optional fields and rejects unsafe envelopes", () => {
    const document = createFigureDocument({
      id: "figure-safe",
      name: "Safe",
      datasetId: "dataset-1",
      view: defaultPlotView(),
    });
    const dirty = {
      ...document,
      bindings: { ...document.bindings, yKeys: [1, "bad", -2], errors: [{ nope: true }] },
      plot: { ...document.plot, mark: "unknown", axisBreaks: { x: [[5, 1], [1, 2]] } },
      output: { ...document.output, dpi: -10 },
    };

    expect(sanitizeFigureDocument(dirty)).toMatchObject({
      bindings: { yKeys: [1], errors: [] },
      plot: { mark: "line", axisBreaks: { x: [[1, 2]], y: [], y2: [] } },
      output: { dpi: 300 },
    });
    expect(sanitizeFigureDocument({ ...document, version: 2 })).toBeNull();
    expect(sanitizeFigureDocument({ ...document, id: "" })).toBeNull();
    expect(deserializeFigureDocument("not json")).toBeNull();
  });

  it("commits facade edits while retaining errors the legacy view cannot express", () => {
    const document = createFigureDocument({
      id: "figure-edit",
      name: "Before",
      datasetId: "dataset-1",
      view: { ...defaultPlotView(), errKeys: { 1: 3 } },
      errors: [
        { channel: 3, target: 1, axis: "y", side: "both" },
        { channel: 4, target: 1, axis: "y", side: "+" },
        { channel: 5, target: 1, axis: "y", side: "-" },
        { channel: 6, target: -1, axis: "x", side: "both" },
      ],
    });
    const updated = updateFigureDocumentFromPlotView(document, {
      name: "After",
      view: { ...figureDocumentToPlotView(document), plotTitle: "Edited", errKeys: { 2: 7 } },
    });

    expect(updated.name).toBe("After");
    expect(updated.plot.view.plotTitle).toBe("Edited");
    expect(updated.bindings.errors).toEqual([
      { channel: 4, target: 1, axis: "y", side: "+" },
      { channel: 5, target: 1, axis: "y", side: "-" },
      { channel: 6, target: -1, axis: "x", side: "both" },
      { channel: 7, target: 2, axis: "y", side: "both" },
    ]);
  });

  it("rejects contradictory live/frozen data ownership", () => {
    expect(() => createFigureDocument({
      id: "bad-frozen",
      name: "Bad",
      datasetId: null,
      view: defaultPlotView(),
      data: { mode: "frozen" },
    })).toThrow("requires a data snapshot");

    expect(() => createFigureDocument({
      id: "bad-live",
      name: "Bad",
      datasetId: "dataset-1",
      view: defaultPlotView(),
      data: { mode: "live", snapshot },
    })).toThrow("cannot own a frozen data snapshot");
  });
});
