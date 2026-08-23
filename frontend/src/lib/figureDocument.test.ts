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

describe("FigureDocument v2", () => {
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
    // F4.4: facetKey (like groupKey) is bindings-owned -- it must never leak
    // into `plot.view` as a second, driftable copy.
    expect(document.plot.view).not.toHaveProperty("groupKey");
    expect(document.plot.view).not.toHaveProperty("facetKey");
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
    expect(figureDocumentVersion(restored)).toBe(2);
    expect(figureDocumentVersion({ ...document, version: 3 })).toBe(3);
    expect(figureDocumentVersion({ version: 1 })).toBeNull();
    expect(deserializeFigureDocument(serializeFigureDocument(document))).toEqual(document);
  });

  it("restores JSON-null frozen non-finite cells as NaN without sharing snapshot state", () => {
    const frozen: DataStruct = {
      time: [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      values: [[1, Number.NaN], [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]],
      labels: ["a", "b"],
      units: ["", ""],
      metadata: {},
    };
    const document = createFigureDocument({
      id: "non-finite",
      name: "Frozen non-finite",
      datasetId: null,
      view: defaultPlotView(),
      data: { mode: "frozen", snapshot: frozen },
    });

    const restored = deserializeFigureDocument(serializeFigureDocument(document));

    expect(restored?.data.mode).toBe("frozen");
    expect(Number.isNaN(sanitizeFigureDocument(document)?.data.snapshot?.time[1])).toBe(true);
    const snapshot = restored!.data.snapshot!;
    expect(snapshot.time.map(Number.isNaN)).toEqual([false, true, true, true]);
    expect(snapshot.values.map((row) => row.map(Number.isNaN))).toEqual([[false, true], [true, true]]);
    snapshot.values[0][0] = 99;
    expect(document.data.snapshot?.values[0][0]).toBe(1);

    expect(sanitizeFigureDocument({
      ...document,
      data: { mode: "frozen", snapshot: { ...frozen, values: [["not a cell"]] } },
    })).toBeNull();
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

  // F2.3b: per-series properties (color/width/mode, visibility renames,
  // display order) round-trip through the SAME full JSON serialization save/
  // reopen already relies on for every other canonical field.
  it("round-trips per-series properties through full JSON serialization (F2.3b)", () => {
    const document = createFigureDocument({
      id: "figure-series-json",
      name: "Series JSON",
      datasetId: "dataset-1",
      view: {
        ...defaultPlotView(),
        yKeys: [0, 1],
        seriesStyles: { 0: { color: "--series-4", width: 2, marker: true }, 1: { step: "post" } },
        seriesLabels: { 1: "Renamed" },
        seriesOrder: [1, 0],
        hiddenChannels: [1],
      },
    });
    const restored = deserializeFigureDocument(serializeFigureDocument(document));
    expect(restored?.plot.view.seriesStyles).toEqual({
      0: { color: "--series-4", width: 2, marker: true },
      1: { step: "post" },
    });
    expect(restored?.plot.view.seriesLabels).toEqual({ 1: "Renamed" });
    expect(restored?.plot.view.seriesOrder).toEqual([1, 0]);
    expect(restored?.plot.view.hiddenChannels).toEqual([1]);
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
    expect(sanitizeFigureDocument({ ...document, version: 3 })).toBeNull();
    expect(sanitizeFigureDocument({ ...document, id: "" })).toBeNull();
    expect(deserializeFigureDocument("not json")).toBeNull();
  });

  it("migrates v1 documents to v2 with publication absent and sanitizes publication fields in isolation", () => {
    const document = createFigureDocument({
      id: "publication", name: "Publication", datasetId: "dataset-1", view: defaultPlotView(),
      publication: {
        overrides: { font_size: 11, ticks: { dir: "in", len: 4 }, margins: { left: 0.1 } },
        seriesStyles: [{ color: "#123456", line: "none", marker: true }],
      },
    });
    const v1 = { ...document, version: 1 };
    delete (v1 as { publication?: unknown }).publication;
    const migrated = sanitizeFigureDocument(v1);
    expect(migrated).toMatchObject({ version: 2 });
    expect(migrated).not.toHaveProperty("publication");

    const restored = sanitizeFigureDocument({
      ...document,
      publication: {
        overrides: {
          font_size: -1, ticks: { dir: "in", len: -1, minor: true }, margins: { left: 0.1, right: "bad" },
          x_breaks: [[4, 1], [1, 3]], annotations: [{ x: 1, y: 2, text: "ok", size: -2 }, { x: "bad" }],
        },
        seriesStyles: [{ color: "#abc", width: -1, marker_size: 4, fill: { vs: 2 } }, { line: "bad" }],
      },
    })!;
    expect(restored.publication).toEqual({
      overrides: { ticks: { dir: "in", minor: true }, margins: { left: 0.1 }, x_breaks: [[1, 3]], annotations: [{ x: 1, y: 2, text: "ok" }] },
      seriesStyles: [{ color: "#abc", marker_size: 4, fill: { vs: 2 } }, null],
    });
    restored.publication!.overrides!.margins!.left = 0.8;
    restored.publication!.seriesStyles![0]!.color = "#fff";
    expect(document.publication!.overrides!.margins!.left).toBe(0.1);
    expect(document.publication!.seriesStyles![0]!.color).toBe("#123456");
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

  // FIGURE_AUTHORING_WORKFLOW_PLAN F4.4: facetKey is bindings-owned, wired
  // the SAME two-direction way groupKey already was -- a facet arrangement
  // built via `facetByColumn` (which lives on the live PlotView facade, see
  // `store/useApp.ts`) must reach `document.bindings.facetKey` on commit,
  // and a document's durable facetKey must reach the facade on open/reopen.
  it("projects the durable facetKey into the live facade view", () => {
    const document = createFigureDocument({
      id: "figure-facet",
      name: "Faceted",
      datasetId: "dataset-1",
      view: defaultPlotView(),
      facetKey: 2,
    });
    expect(figureDocumentToPlotView(document).facetKey).toBe(2);
  });

  it("commits a live facetKey edit back onto the canonical document", () => {
    const document = createFigureDocument({
      id: "figure-facet-2",
      name: "Before",
      datasetId: "dataset-1",
      view: defaultPlotView(),
    });
    expect(document.bindings.facetKey).toBeNull();
    const updated = updateFigureDocumentFromPlotView(document, {
      view: { ...figureDocumentToPlotView(document), facetKey: 3 },
    });
    expect(updated.bindings.facetKey).toBe(3);
    // Round-trips through the SAME full JSON serialization save/reopen relies on.
    const restored = deserializeFigureDocument(serializeFigureDocument(updated));
    expect(restored?.bindings.facetKey).toBe(3);
    expect(figureDocumentToPlotView(restored!).facetKey).toBe(3);
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
