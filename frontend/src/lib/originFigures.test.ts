import { describe, expect, it } from "vitest";

import {
  buildOriginFigureEntries,
  doubleYPartner,
  figureChannelSelection,
  figureLabel,
  figureLayerFamily,
  originCurveSeriesStyle,
  originFigureAnnotations,
  originLegendPos,
  type OriginFigureEntry,
  resolveFigureDataset,
  resolveFigurePanels,
} from "./originFigures";
import type { Dataset, OriginCurve, OriginFigure } from "./types";

const figure = (overrides: Partial<OriginFigure> = {}): OriginFigure => ({
  name: "Graph1",
  x_from: 18,
  x_to: 100,
  x_log: false,
  y_from: 1,
  y_to: 1e6,
  y_log: true,
  n_curves: 3,
  annotations: [],
  ...overrides,
});

const book = (id: string, name: string, meta: Record<string, unknown> = {}): Dataset => ({
  id,
  name,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: meta },
});

describe("resolveFigureDataset", () => {
  it("resolves unambiguously when there is only one candidate", () => {
    const only = book("d1", "XRD.opj");
    expect(resolveFigureDataset(figure({ source_hint: "anything" }), [only])).toBe("d1");
    expect(resolveFigureDataset(figure({ source_hint: undefined }), [only])).toBe("d1");
  });

  it("returns null with no candidates", () => {
    expect(resolveFigureDataset(figure(), [])).toBeNull();
  });

  it("matches a multi-candidate figure by origin_book short name", () => {
    const candidates = [
      book("b1", "XRD:Book1", { origin_book: "Book1" }),
      book("b2", "XRD:Book2", { origin_book: "Book2" }),
    ];
    expect(resolveFigureDataset(figure({ source_hint: "Book2" }), candidates)).toBe("b2");
  });

  it("matches by origin_book_long when the short name doesn't hit", () => {
    const candidates = [
      book("b1", "XRD:Book1", { origin_book: "Book1", origin_book_long: "30 nm MnN" }),
      book("b2", "XRD:Book2", { origin_book: "Book2" }),
    ];
    expect(resolveFigureDataset(figure({ source_hint: "30 nm MnN" }), candidates)).toBe("b1");
  });

  it("returns null when no candidate's name/metadata matches the hint (never guesses)", () => {
    const candidates = [
      book("b1", "XRD:Book1", { origin_book: "Book1" }),
      book("b2", "XRD:Book2", { origin_book: "Book2" }),
    ];
    expect(resolveFigureDataset(figure({ source_hint: "Nonexistent" }), candidates)).toBeNull();
  });

  it("returns null for a blank hint among multiple candidates", () => {
    const candidates = [
      book("b1", "XRD:Book1", { origin_book: "Book1" }),
      book("b2", "XRD:Book2", { origin_book: "Book2" }),
    ];
    expect(resolveFigureDataset(figure({ source_hint: "" }), candidates)).toBeNull();
  });

  it("resolves by decoded curve book exactly, beating the hint heuristic", () => {
    const candidates = [
      book("b1", "XAS:Co", { origin_book: "Co" }),
      book("b2", "XAS:bl11YIGPy032", { origin_book: "bl11YIGPy032" }),
    ];
    const fig = figure({
      source_hint: "Co", // would heuristically hit b1...
      curves: [{ book: "bl11YIGPy032", x: "A", y: "C" }], // ...but the binding is exact
    });
    expect(resolveFigureDataset(fig, candidates)).toBe("b2");
  });

  it("falls back to the hint when no curve book matches a candidate", () => {
    const candidates = [
      book("b1", "XRD:Book1", { origin_book: "Book1" }),
      book("b2", "XRD:Book2", { origin_book: "Book2" }),
    ];
    const fig = figure({ source_hint: "Book2", curves: [{ book: "Elsewhere", x: "A", y: "B" }] });
    expect(resolveFigureDataset(fig, candidates)).toBe("b2");
  });
});

describe("originCurveSeriesStyle", () => {
  it("maps scatter/line as before (no color/symbol decoded)", () => {
    expect(originCurveSeriesStyle({ style: "scatter" })).toEqual({ marker: true, width: 0 });
    expect(originCurveSeriesStyle({ style: "line" })).toEqual({ width: 1.5 });
    expect(originCurveSeriesStyle({})).toBeNull();
    expect(originCurveSeriesStyle(undefined)).toBeNull();
  });

  it("applies the decoded Origin color on top of the trace style", () => {
    expect(originCurveSeriesStyle({ style: "scatter", color: "#F14040" })).toEqual({
      marker: true,
      width: 0,
      color: "#F14040",
    });
    expect(originCurveSeriesStyle({ style: "line", color: "#1A6FDF" })).toEqual({
      width: 1.5,
      color: "#1A6FDF",
    });
  });

  it("applies a decoded symbol shape as the marker glyph", () => {
    expect(
      originCurveSeriesStyle({ style: "scatter", color: "#515151", symbol: "circle" }),
    ).toEqual({ marker: true, width: 0, color: "#515151", markerShape: "circle" });
  });

  it("styles a curve with color/symbol but no line-vs-scatter decode", () => {
    // e.g. Origin's line+symbol plots: style byte unmapped, but color and
    // symbol kind decoded — apply both without forcing a trace shape.
    expect(originCurveSeriesStyle({ color: "#FF8000", symbol: "square" })).toEqual({
      color: "#FF8000",
      marker: true,
      markerShape: "square",
    });
    expect(originCurveSeriesStyle({ color: "#FF8000" })).toEqual({ color: "#FF8000" });
  });

  it("rejects malformed colors and unknown symbol names (fail closed)", () => {
    expect(originCurveSeriesStyle({ color: "red" })).toBeNull();
    expect(originCurveSeriesStyle({ color: "#12345" })).toBeNull();
    expect(originCurveSeriesStyle({ symbol: "blob" })).toBeNull();
  });

  it("applies decoded lineWidth/symbolSize (u16@21/25, shipped 2026-07-06)", () => {
    expect(
      originCurveSeriesStyle({ style: "line", lineWidth: 3 }),
    ).toEqual({ width: 3 });
    expect(
      originCurveSeriesStyle({ style: "scatter", symbol: "circle", symbolSize: 9 }),
    ).toEqual({ marker: true, width: 0, markerShape: "circle", markerSize: 9 });
    // symbolSize without any marker means nothing to size — ignored
    expect(originCurveSeriesStyle({ style: "line", symbolSize: 9 })).toEqual({ width: 1.5 });
  });

  it("never lets the latent stored lineWidth draw a line on a scatter plot", () => {
    // Origin stores a line width even on symbol-only plots; a scatter curve
    // must keep width 0 or the restored figure grows lines Origin never drew.
    expect(
      originCurveSeriesStyle({ style: "scatter", lineWidth: 0.5, symbolSize: 9, symbol: "square" }),
    ).toEqual({ marker: true, width: 0, markerShape: "square", markerSize: 9 });
    // undetermined style (line+symbol plots): decoded width still applies
    expect(
      originCurveSeriesStyle({ lineWidth: 2, symbol: "circle", symbolSize: 6 }),
    ).toEqual({ width: 2, marker: true, markerShape: "circle", markerSize: 6 });
  });
});

describe("figureChannelSelection", () => {
  const ds = book("b1", "XAS:Co", {
    origin_book: "Co",
    x_column_name: "A",
    origin_column_names: ["B", "C"], // value channels 0, 1
  });

  it("maps curve y letters onto value-channel indices", () => {
    const fig = figure({ curves: [{ book: "Co", x: "A", y: "C" }] });
    expect(figureChannelSelection(fig, ds)).toEqual({ xKey: null, yKeys: [1], styles: {} });
  });

  it("selects a non-default x channel when the curve's x is not the dataset x", () => {
    const fig = figure({ curves: [{ book: "Co", x: "B", y: "C" }] });
    expect(figureChannelSelection(fig, ds)).toEqual({ xKey: 0, yKeys: [1], styles: {} });
  });

  it("collects multiple curves, deduplicated", () => {
    const fig = figure({
      curves: [
        { book: "Co", x: "A", y: "B" },
        { book: "Co", x: "A", y: "C" },
        { book: "Co", x: "A", y: "C" },
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({ xKey: null, yKeys: [0, 1], styles: {} });
  });

  it("maps decoded line/scatter styles onto the plotted channels", () => {
    const fig = figure({
      curves: [
        { book: "Co", x: "A", y: "B", style: "scatter" }, // ch 0 → markers, no line
        { book: "Co", x: "A", y: "C", style: "line" }, // ch 1 → line at default width
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [0, 1],
      styles: { 0: { marker: true, width: 0 }, 1: { width: 1.5 } },
    });
  });

  it("carries decoded color + symbol into the channel styles", () => {
    const fig = figure({
      curves: [
        { book: "Co", x: "A", y: "B", style: "scatter", color: "#F14040", symbol: "triangle" },
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [0],
      styles: { 0: { marker: true, width: 0, color: "#F14040", markerShape: "triangle" } },
    });
  });

  it("returns null when no curve targets this book (default view stands)", () => {
    const fig = figure({ curves: [{ book: "Other", x: "A", y: "B" }] });
    expect(figureChannelSelection(fig, ds)).toBeNull();
  });

  it("returns null with no curves or no origin_column_names metadata", () => {
    expect(figureChannelSelection(figure(), ds)).toBeNull();
    const bare = book("b2", "bare", { origin_book: "Co" });
    expect(figureChannelSelection(figure({ curves: [{ book: "Co", x: "A", y: "B" }] }), bare)).toBeNull();
  });

  it("skips letters that aren't decodable channels (e.g. text columns)", () => {
    const fig = figure({
      curves: [
        { book: "Co", x: "A", y: "Z" }, // dropped column — no channel
        { book: "Co", x: "A", y: "B" },
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({ xKey: null, yKeys: [0], styles: {} });
  });
});

describe("buildOriginFigureEntries", () => {
  it("tags each figure with the stem and its resolved (or null) dataset id", () => {
    const candidates = [
      book("b1", "XRD:Book1", { origin_book: "Book1" }),
      book("b2", "XRD:Book2", { origin_book: "Book2" }),
    ];
    const figures = [figure({ name: "Graph1", source_hint: "Book1" }), figure({ name: "Graph2", source_hint: "gone" })];
    const entries = buildOriginFigureEntries("XRD", figures, candidates);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ stem: "XRD", datasetId: "b1" });
    expect(entries[1]).toMatchObject({ stem: "XRD", datasetId: null });
    expect(new Set(entries.map((e) => e.id)).size).toBe(2); // stable, unique ids
    // Each entry carries the import's sibling dataset ids (for overlay scoping).
    expect(entries[0].siblingIds).toEqual(["b1", "b2"]);
    expect(entries[1].siblingIds).toEqual(["b1", "b2"]);
  });

  it("gives two imports of a SAME-named file disjoint ids (no cross-import collision)", () => {
    const figs = [figure({ name: "Graph1" })];
    // Two separate imports of XRD.opj -> different dataset ids each time.
    const a = buildOriginFigureEntries("XRD", figs, [book("a1", "XRD:Book1", { origin_book: "Book1" })]);
    const b = buildOriginFigureEntries("XRD", figs, [book("b9", "XRD:Book1", { origin_book: "Book1" })]);
    expect(a[0].id).not.toBe(b[0].id); // keyed on the import-unique sibling id
    expect(a[0].siblingIds).toEqual(["a1"]);
    expect(b[0].siblingIds).toEqual(["b9"]);
  });
});

describe("figureLabel", () => {
  it("suffixes layers >= 2 with the layer number", () => {
    const entry = { id: "f1", stem: "M", datasetId: "b1", siblingIds: [], figure: figure({ name: "Graph4", layer: 2 }) };
    expect(figureLabel(entry)).toBe("Graph4 · layer 2");
    const l1 = { id: "f2", stem: "M", datasetId: "b1", siblingIds: [], figure: figure({ name: "Graph4", layer: 1 }) };
    expect(figureLabel(l1)).toBe("Graph4");
  });


  it("prefers a surviving annotation over the raw window name", () => {
    const entry = { id: "f1", stem: "XRD", datasetId: "b1", siblingIds: [], figure: figure({ name: "Graph1", annotations: ["Si (004)"] }) };
    expect(figureLabel(entry)).toBe("Si (004)");
  });

  it("falls back to the window name with no annotations", () => {
    const entry = { id: "f1", stem: "XRD", datasetId: "b1", siblingIds: [], figure: figure({ name: "Graph3", annotations: [] }) };
    expect(figureLabel(entry)).toBe("Graph3");
  });
});

describe("doubleYPartner", () => {
  const curve = (y: string): OriginCurve => ({ book: "B1", x: "A", y });

  const layerEntry = (
    id: string,
    layer: number,
    datasetId: string | null,
    curves: OriginCurve[] | undefined,
    siblingIds: string[] = ["imp1"], // same import unless a test overrides
  ): OriginFigureEntry => ({
    id,
    stem: "Moke",
    datasetId,
    siblingIds,
    figure: figure({ name: "Graph7", layer, curves }),
  });

  it("finds the other layer's entry for a genuine double-Y pair, symmetrically", () => {
    const l1 = layerEntry("f1", 1, "d1", [curve("B")]);
    const l2 = layerEntry("f2", 2, "d1", [curve("C")]);
    expect(doubleYPartner(l1, [l1, l2])).toBe(l2);
    expect(doubleYPartner(l2, [l1, l2])).toBe(l1);
  });

  it("returns null when more than 2 layers share the window name (composite/panel window)", () => {
    const l1 = layerEntry("f1", 1, "d1", [curve("B")]);
    const l2 = layerEntry("f2", 2, "d1", [curve("C")]);
    const l3 = layerEntry("f3", 3, "d1", [curve("D")]);
    expect(doubleYPartner(l1, [l1, l2, l3])).toBeNull();
  });

  it("returns null when the two layers resolved to different datasets", () => {
    const l1 = layerEntry("f1", 1, "d1", [curve("B")]);
    const l2 = layerEntry("f2", 2, "d2", [curve("C")]);
    expect(doubleYPartner(l1, [l1, l2])).toBeNull();
  });

  it("returns null when either datasetId is unresolved (null)", () => {
    const l1 = layerEntry("f1", 1, null, [curve("B")]);
    const l2 = layerEntry("f2", 2, "d1", [curve("C")]);
    expect(doubleYPartner(l1, [l1, l2])).toBeNull();
  });

  it("returns null when either layer has no decoded curves", () => {
    const l1 = layerEntry("f1", 1, "d1", []);
    const l2 = layerEntry("f2", 2, "d1", [curve("C")]);
    expect(doubleYPartner(l1, [l1, l2])).toBeNull();
    const l1b = layerEntry("f1", 1, "d1", undefined);
    expect(doubleYPartner(l1b, [l1b, l2])).toBeNull();
  });

  it("returns null for a single-layer figure (no partner shares the name)", () => {
    const l1 = layerEntry("f1", 1, "d1", [curve("B")]);
    expect(doubleYPartner(l1, [l1])).toBeNull();
  });
});

describe("figureLayerFamily", () => {
  const layerEntry = (
    id: string,
    layer: number,
    datasetId: string | null,
    curves: OriginCurve[] | undefined,
    overrides: Partial<Pick<OriginFigureEntry, "stem" | "siblingIds">> = {},
  ): OriginFigureEntry => ({
    id,
    stem: overrides.stem ?? "Moke",
    datasetId,
    siblingIds: overrides.siblingIds ?? ["imp1"],
    figure: figure({ name: "Graph7", layer, curves }),
  });

  it("collects every same-window layer, sorted by layer number ascending", () => {
    const l3 = layerEntry("f3", 3, "d1", []);
    const l1 = layerEntry("f1", 1, "d1", []);
    const l2 = layerEntry("f2", 2, "d1", []);
    // Deliberately out-of-order input — the family must come back sorted.
    expect(figureLayerFamily(l1, [l3, l1, l2]).map((e) => e.id)).toEqual(["f1", "f2", "f3"]);
  });

  it("scopes to the SAME import (siblingIds[0]) so a same-named window from a different import doesn't join", () => {
    const l1 = layerEntry("f1", 1, "d1", [], { siblingIds: ["impA"] });
    const l2 = layerEntry("f2", 2, "d1", [], { siblingIds: ["impA"] });
    const other = layerEntry("f9", 1, "d9", [], { siblingIds: ["impB"] });
    expect(figureLayerFamily(l1, [l1, l2, other]).map((e) => e.id)).toEqual(["f1", "f2"]);
  });

  it("returns just itself for a nameless figure or one with no same-window siblings", () => {
    const l1 = layerEntry("f1", 1, "d1", []);
    expect(figureLayerFamily(l1, [l1]).map((e) => e.id)).toEqual(["f1"]);
    const nameless: OriginFigureEntry = { ...l1, figure: { ...l1.figure, name: "" } };
    expect(figureLayerFamily(nameless, [nameless, l1])).toEqual([nameless]);
  });
});

describe("resolveFigurePanels", () => {
  const ds1 = book("d1", "M:Book1", {
    origin_book: "Book1",
    x_column_name: "A",
    origin_column_names: ["B", "C"],
  });
  const ds2 = book("d2", "M:Book2", {
    origin_book: "Book2",
    x_column_name: "A",
    origin_column_names: ["B"],
  });

  const entry = (
    id: string,
    layer: number,
    datasetId: string | null,
    figOverrides: Partial<OriginFigure>,
  ): OriginFigureEntry => ({
    id,
    stem: "M",
    datasetId,
    siblingIds: [datasetId ?? "none"],
    figure: figure({ name: "Graph9", layer, ...figOverrides }),
  });

  it("resolves every family member's dataset + channel selection + axis state", () => {
    const l1 = entry("f1", 1, "d1", {
      x_from: 0, x_to: 10, y_from: 0, y_to: 50, x_title: "Time", y_title: "V",
      curves: [{ book: "Book1", x: "A", y: "B" }],
    });
    const l2 = entry("f2", 2, "d2", {
      x_from: 0, x_to: 20, y_from: -1, y_to: 1, y_log: false,
      curves: [{ book: "Book2", x: "A", y: "B" }],
    });
    const panels = resolveFigurePanels([l1, l2], [ds1, ds2]);
    expect(panels).toEqual([
      { datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 10], yLim: [0, 50], xLog: false, yLog: true, xAxisLabel: "Time", yAxisLabel: "V", seriesStyles: {} },
      { datasetId: "d2", xKey: null, yKeys: [0], xLim: [0, 20], yLim: [-1, 1], xLog: false, yLog: false, xAxisLabel: undefined, yAxisLabel: undefined, seriesStyles: {} },
    ]);
  });

  it("returns null (all-or-nothing) when ANY family member has no resolved dataset", () => {
    const l1 = entry("f1", 1, "d1", { curves: [{ book: "Book1", x: "A", y: "B" }] });
    const l2 = entry("f2", 2, null, { curves: [{ book: "Book2", x: "A", y: "B" }] });
    expect(resolveFigurePanels([l1, l2], [ds1, ds2])).toBeNull();
  });

  it("returns null (all-or-nothing) when ANY family member's channel selection is empty", () => {
    const l1 = entry("f1", 1, "d1", { curves: [{ book: "Book1", x: "A", y: "B" }] });
    const l2 = entry("f2", 2, "d2", { curves: [{ book: "Elsewhere", x: "A", y: "B" }] }); // wrong book -> no selection
    expect(resolveFigurePanels([l1, l2], [ds1, ds2])).toBeNull();
  });
});

describe("originFigureAnnotations", () => {
  it("maps annotation_marks to plot Annotations with generated ids", () => {
    const f = figure({
      annotation_marks: [
        { text: "Field applied in-plane\nT = 1.3 K", x: -5.311, y: 0.4915 },
        { text: "Peak label", x: 2.5, y: 100 },
      ],
    });
    const anns = originFigureAnnotations([f], "fig-key");
    expect(anns).toHaveLength(2);
    expect(anns[0]).toEqual({
      id: "figann-fig-key-0-0",
      x: -5.311,
      y: 0.4915,
      text: "Field applied in-plane\nT = 1.3 K",
    });
    expect(anns[1].id).toBe("figann-fig-key-0-1");
    expect(new Set(anns.map((a) => a.id)).size).toBe(2); // ids unique
  });

  it("returns [] when the figure carries no marks (field absent or empty)", () => {
    expect(originFigureAnnotations([figure()], "k")).toEqual([]);
    expect(originFigureAnnotations([figure({ annotation_marks: [] })], "k")).toEqual([]);
    expect(originFigureAnnotations([], "k")).toEqual([]);
  });

  it("concatenates marks across figure layers (double-Y apply)", () => {
    const l1 = figure({ annotation_marks: [{ text: "on layer 1", x: 1, y: 2 }] });
    const l2 = figure({ annotation_marks: [{ text: "on layer 2", x: 3, y: 4 }] });
    const anns = originFigureAnnotations([l1, l2], "fig-0");
    expect(anns.map((a) => a.text)).toEqual(["on layer 1", "on layer 2"]);
    expect(anns.map((a) => a.id)).toEqual(["figann-fig-0-0-0", "figann-fig-0-1-0"]);
  });
});

describe("originLegendPos", () => {
  const base = { x_from: 0, x_to: 10, x_log: false, y_from: 0, y_to: 100, y_log: false };

  it("maps the decoded legend box corner to the nearest corner preset", () => {
    expect(originLegendPos({ ...base, legend_pos: { x: 8, y: 90 } })).toBe("ne");
    expect(originLegendPos({ ...base, legend_pos: { x: 1, y: 90 } })).toBe("nw");
    expect(originLegendPos({ ...base, legend_pos: { x: 8, y: 10 } })).toBe("se");
    expect(originLegendPos({ ...base, legend_pos: { x: 1, y: 10 } })).toBe("sw");
  });

  it("computes the fraction in log10 space on log axes", () => {
    // y 1..1e5 (log): 7.3e4 sits at ~0.97 of the DECADE span (top) even
    // though it is 0.73 linearly; x 1..100 (log): 5 is below the midpoint.
    expect(
      originLegendPos({
        x_from: 1, x_to: 100, x_log: true,
        y_from: 1, y_to: 1e5, y_log: true,
        legend_pos: { x: 5, y: 7.3e4 },
      }),
    ).toBe("nw");
  });

  it("returns null when absent or the range is degenerate", () => {
    expect(originLegendPos({ ...base, legend_pos: null })).toBeNull();
    expect(originLegendPos({ ...base })).toBeNull();
    expect(
      originLegendPos({ ...base, x_from: 5, x_to: 5, legend_pos: { x: 5, y: 50 } }),
    ).toBeNull();
  });
});
