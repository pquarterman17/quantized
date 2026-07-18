import { describe, expect, it } from "vitest";

import {
  buildOriginFigureEntries,
  curveDisplayName,
  doubleYPartner,
  figureChannelSelection,
  figureFrameY2Pairs,
  figureLabel,
  figureLayerFamily,
  figureSelectionState,
  originCurveSeriesStyle,
  originFigureAnnotations,
  originLegendFrameXY,
  originLegendPos,
  originLegendState,
  originRegionShades,
  type OriginFigureEntry,
  resolveFigureDataset,
  resolveFigurePanels,
  resolveLegendTemplate,
  resolveSpatialPanels,
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

  it("styles a curve with color/symbol when its plot type is unknown", () => {
    // The e7/e9 plot families remain unmapped, but independently decoded
    // color and symbol fields still apply without forcing a trace shape.
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
    expect(
      originCurveSeriesStyle({
        style: "line_symbol",
        symbol: "triangle",
        lineWidth: 2,
        symbolSize: 7,
      }),
    ).toEqual({ marker: true, width: 2, markerShape: "triangle", markerSize: 7 });
  });

  it("never lets the latent stored lineWidth draw a line on a scatter plot", () => {
    // Origin stores a line width even on symbol-only plots; a scatter curve
    // must keep width 0 or the restored figure grows lines Origin never drew.
    expect(
      originCurveSeriesStyle({ style: "scatter", lineWidth: 0.5, symbolSize: 9, symbol: "square" }),
    ).toEqual({ marker: true, width: 0, markerShape: "square", markerSize: 9 });
    // undetermined plot family: decoded width still applies
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
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [1],
      styles: {},
      labels: {},
      errKeys: {},
      hiddenChannels: [],
    });
  });

  it("selects a non-default x channel when the curve's x is not the dataset x", () => {
    const fig = figure({ curves: [{ book: "Co", x: "B", y: "C" }] });
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: 0,
      yKeys: [1],
      styles: {},
      labels: {},
      errKeys: {},
      hiddenChannels: [],
    });
  });

  it("collects multiple curves, deduplicated", () => {
    const fig = figure({
      curves: [
        { book: "Co", x: "A", y: "B" },
        { book: "Co", x: "A", y: "C" },
        { book: "Co", x: "A", y: "C" },
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [0, 1],
      styles: {},
      labels: {},
      errKeys: {},
      hiddenChannels: [],
    });
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
      labels: {},
      errKeys: {},
      hiddenChannels: [],
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
      labels: {},
      errKeys: {},
      hiddenChannels: [],
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
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [0],
      styles: {},
      labels: {},
      errKeys: {},
      hiddenChannels: [],
    });
  });

  // Fix #4: decoded legend_labels wired into per-channel seriesLabels.
  it("maps decoded legend labels onto the bound curves, in curve-binding order", () => {
    const fig = figure({
      legend_labels: ["Nb", "Nb/Al"],
      curves: [
        { book: "Co", x: "A", y: "B" },
        { book: "Co", x: "A", y: "C" },
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [0, 1],
      styles: {},
      labels: { 0: "Nb", 1: "Nb/Al" },
      errKeys: {},
      hiddenChannels: [],
    });
  });

  it("applies only the matching prefix when the legend list is shorter than the bound curves (never crashes)", () => {
    const fig = figure({
      legend_labels: ["Nb"], // only the first curve's caption decoded
      curves: [
        { book: "Co", x: "A", y: "B" },
        { book: "Co", x: "A", y: "C" },
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [0, 1],
      styles: {},
      labels: { 0: "Nb" }, // channel 1 (curve 2) keeps its default label
      errKeys: {},
      hiddenChannels: [],
    });
  });

  it("skips a blank legend slot (a gap in Origin's \\l(n) numbering) without an empty-string override", () => {
    const fig = figure({
      legend_labels: ["", "Nb/Au"], // slot 1 undecoded
      curves: [
        { book: "Co", x: "A", y: "B" },
        { book: "Co", x: "A", y: "C" },
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [0, 1],
      styles: {},
      labels: { 1: "Nb/Au" },
      errKeys: {},
      hiddenChannels: [],
    });
  });

  it("ignores an absent/empty legend_labels list entirely (no override)", () => {
    const fig = figure({ curves: [{ book: "Co", x: "A", y: "B" }] });
    expect(figureChannelSelection(fig, ds)).toEqual({
      xKey: null,
      yKeys: [0],
      styles: {},
      labels: {},
      errKeys: {},
      hiddenChannels: [],
    });
  });

  // Owner repro (PNR.opj live import): untouched auto-template legend text
  // ("%(1)"/"%(2)") must resolve to the bound column's own display name, not
  // show the raw Origin code.
  it("resolves an auto-template legend_labels entry (%(n)) to the bound curve's column long name", () => {
    const dsNamed: Dataset = {
      id: "b9",
      name: "XAS:Co",
      data: {
        time: [0],
        values: [[1, 2]],
        labels: ["Temperature (K)", "Resistance (Ohm)"],
        units: ["K", "Ohm"],
        metadata: { origin_book: "Co", x_column_name: "A", origin_column_names: ["B", "C"] },
      },
    };
    const fig = figure({
      legend_labels: ["%(1)", "%(2)"],
      curves: [
        { book: "Co", x: "A", y: "B" },
        { book: "Co", x: "A", y: "C" },
      ],
    });
    expect(figureChannelSelection(fig, dsNamed)).toEqual({
      xKey: null,
      yKeys: [0, 1],
      styles: {},
      labels: { 0: "Temperature (K)", 1: "Resistance (Ohm)" },
      errKeys: {},
      hiddenChannels: [],
    });
  });

  it("falls back to the column short name for %(n) when the dataset has no long name for that channel", () => {
    const dsNoLongNames: Dataset = {
      id: "b10",
      name: "XAS:Co",
      data: {
        time: [0],
        values: [[1, 2]],
        labels: ["", ""], // no long name decoded for either column
        units: ["", ""],
        metadata: { origin_book: "Co", x_column_name: "A", origin_column_names: ["B", "C"] },
      },
    };
    const fig = figure({
      legend_labels: ["%(1)", "%(2)"],
      curves: [
        { book: "Co", x: "A", y: "B" },
        { book: "Co", x: "A", y: "C" },
      ],
    });
    expect(figureChannelSelection(fig, dsNoLongNames)).toEqual({
      xKey: null,
      yKeys: [0, 1],
      styles: {},
      labels: { 0: "B", 1: "C" }, // short (column-letter) fallback
      errKeys: {},
      hiddenChannels: [],
    });
  });

  // Item A (PNR.opj Book14 Graph11 repro): the multi-panel path never
  // applied error pairing / hidden-channel suppression at all — this is the
  // chokepoint that now threads a book's Origin worksheet designations
  // (errorbars.originErrKeys/originHiddenChannels) into the resolved
  // selection, so `resolveFigurePanels` can build whiskers instead of a
  // spurious series for a "Y-error" column.
  it("threads a book's Origin Y-error pairing + hidden channels into the resolved selection", () => {
    const dsErr: Dataset = {
      id: "b11",
      name: "PNR:Book14",
      data: {
        time: [0],
        values: [[1, 2]], // SA, dSA
        labels: ["SA", "dSA"],
        units: ["", ""],
        metadata: {
          origin_book: "Book14",
          x_column_name: "A",
          origin_column_names: ["B", "C"], // B=SA (value ch 0), C=dSA (value ch 1)
          column_designations: { B: "Y", C: "Y-error" },
        },
      },
    };
    const fig = figure({ curves: [{ book: "Book14", x: "A", y: "B" }] });
    expect(figureChannelSelection(fig, dsErr)).toEqual({
      xKey: null,
      yKeys: [0],
      styles: {},
      labels: {},
      errKeys: { 0: 1 }, // SA (channel 0) <- dSA (channel 1)
      hiddenChannels: [1], // dSA never plots as its own series
    });
  });
});

describe("resolveLegendTemplate", () => {
  // curveNames[n - 1] = the nth curve's display name; index 2 (curve 3) is
  // deliberately undefined — an unresolved/unbound curve.
  const names = ["Temperature (K)", "Resistance (Ohm)", undefined, "Field (Oe)"];

  it("resolves a plain %(n) template to the nth curve's name", () => {
    expect(resolveLegendTemplate("%(1)", names)).toBe("Temperature (K)");
    expect(resolveLegendTemplate("%(2)", names)).toBe("Resistance (Ohm)");
    expect(resolveLegendTemplate("%(4)", names)).toBe("Field (Oe)");
  });

  it("resolves multiple %(n) codes within one string", () => {
    expect(resolveLegendTemplate("%(1) vs %(2)", names)).toBe("Temperature (K) vs Resistance (Ohm)");
  });

  it("strips a leading \\l(n) swatch marker (and its trailing whitespace) before resolving", () => {
    expect(resolveLegendTemplate("\\l(1) %(1)", names)).toBe("Temperature (K)");
    expect(resolveLegendTemplate("\\l(2)%(2)", names)).toBe("Resistance (Ohm)"); // no space either
  });

  it("passes through hand-typed literal legend text unchanged", () => {
    expect(resolveLegendTemplate("Nb/Al", names)).toBe("Nb/Al");
    expect(resolveLegendTemplate("R↑↑", names)).toBe("R↑↑"); // "R↑↑", hc2/PNR corpus form
    expect(resolveLegendTemplate("", names)).toBe("");
  });

  it("leaves a %(n) code unresolved (raw) when that curve's name is unavailable", () => {
    expect(resolveLegendTemplate("%(3)", names)).toBe("%(3)"); // names[2] is undefined
    expect(resolveLegendTemplate("%(11)", names)).toBe("%(11)"); // out of range entirely
  });

  it("leaves an @-modifier template unresolved rather than guessing its meaning (seen live in Hc2 data.opju Graph40)", () => {
    expect(resolveLegendTemplate("%(7,@LG)", names)).toBe("%(7,@LG)");
    expect(resolveLegendTemplate("\\l(7) %(7,@LG)", names)).toBe("%(7,@LG)"); // swatch still stripped
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
      { sourceFigureIds: ["f1"], datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 10], yLim: [0, 50], xLog: false, yLog: true, xAxisLabel: "Time", yAxisLabel: "V", seriesStyles: {}, seriesLabels: {}, errKeys: {}, hiddenChannels: [], xStep: null, yStep: null, annotations: [] },
      { sourceFigureIds: ["f2"], datasetId: "d2", xKey: null, yKeys: [0], xLim: [0, 20], yLim: [-1, 1], xLog: false, yLog: false, xAxisLabel: undefined, yAxisLabel: undefined, seriesStyles: {}, seriesLabels: {}, errKeys: {}, hiddenChannels: [], xStep: null, yStep: null, annotations: [] },
    ]);
  });

  it("carries each layer's decoded x_step/y_step and its OWN annotation_marks (fixes #2 + #5)", () => {
    const l1 = entry("f1", 1, "d1", {
      x_from: 0, x_to: 10, y_from: 0, y_to: 50, x_step: 2, y_step: 10,
      curves: [{ book: "Book1", x: "A", y: "B" }],
      annotation_marks: [{ text: "panel 1 label", x: 5, y: 25 }],
    });
    const l2 = entry("f2", 2, "d2", {
      x_from: 0, x_to: 20, y_from: -1, y_to: 1,
      curves: [{ book: "Book2", x: "A", y: "B" }],
      // no x_step/y_step/marks decoded on this layer
    });
    const panels = resolveFigurePanels([l1, l2], [ds1, ds2]);
    expect(panels?.[0].xStep).toBe(2);
    expect(panels?.[0].yStep).toBe(10);
    expect(panels?.[0].annotations).toEqual([
      { id: "figann-f1-0-0", x: 5, y: 25, text: "panel 1 label" },
    ]);
    expect(panels?.[1].xStep).toBeNull();
    expect(panels?.[1].yStep).toBeNull();
    expect(panels?.[1].annotations).toEqual([]);
  });

  it("carries each layer's decoded legend_labels into its own seriesLabels", () => {
    const l1 = entry("f1", 1, "d1", {
      legend_labels: ["Field-cooled"],
      legend_title: "Cooling sweep",
      legend_pos: { x: 2, y: 40 },
      x_from: 0, x_to: 10, y_from: 0, y_to: 50, x_log: false, y_log: false,
      curves: [{ book: "Book1", x: "A", y: "B" }],
    });
    const panels = resolveFigurePanels([l1, entry("f2", 2, "d2", { curves: [{ book: "Book2", x: "A", y: "B" }] })], [ds1, ds2]);
    expect(panels?.[0].seriesLabels).toEqual({ 0: "Field-cooled" });
    expect(panels?.[0].legendTitle).toBe("Cooling sweep");
    expect(panels?.[0].legendFrameXY?.[0]).toBeCloseTo(0.2);
    expect(panels?.[0].legendFrameXY?.[1]).toBeCloseTo(0.2);
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

  // Item A (PNR.opj Book14 Graph11 repro): each panel carries its OWN book's
  // errKeys/hiddenChannels through from `figureChannelSelection`.
  it("carries each panel's own book errKeys/hiddenChannels through", () => {
    const dsErr = book("d3", "PNR:Book14", {
      origin_book: "Book14",
      x_column_name: "A",
      origin_column_names: ["B", "C"], // B=SA (ch 0), C=dSA (ch 1)
      column_designations: { B: "Y", C: "Y-error" },
    });
    const l1 = entry("f1", 1, "d3", { curves: [{ book: "Book14", x: "A", y: "B" }] });
    const l2 = entry("f2", 2, "d2", { curves: [{ book: "Book2", x: "A", y: "B" }] });
    const panels = resolveFigurePanels([l1, l2], [dsErr, ds2]);
    expect(panels?.[0].errKeys).toEqual({ 0: 1 });
    expect(panels?.[0].hiddenChannels).toEqual([1]);
    // ds2 has no column_designations metadata — no error pairing to carry.
    expect(panels?.[1].errKeys).toEqual({});
    expect(panels?.[1].hiddenChannels).toEqual([]);
  });

  // Item B (decode-plan #36 residual, PNR.opj Graph11): an EXPLICITLY blank
  // decoded x_title ("" — the owner hand-deleted a redundant per-panel
  // label) must come through as `null` (force blank), distinct from an
  // UNDECODED one (undefined — auto-derive stays the fallback). yAxisLabel
  // keeps the pre-existing `|| undefined` behaviour (item B scopes the
  // title-fidelity fix to x only).
  it("maps an explicitly blank decoded x_title to null, distinct from an undecoded one", () => {
    const l1 = entry("f1", 1, "d1", { x_title: "", curves: [{ book: "Book1", x: "A", y: "B" }] });
    const l2 = entry("f2", 2, "d2", { curves: [{ book: "Book2", x: "A", y: "B" }] }); // x_title never set
    const l3 = entry("f3", 3, "d1", { x_title: "Q (nm-1)", curves: [{ book: "Book1", x: "A", y: "B" }] });
    const panels = resolveFigurePanels([l1, l2, l3], [ds1, ds2, ds1]);
    expect(panels?.[0].xAxisLabel).toBeNull(); // explicit blank -> force nothing
    expect(panels?.[1].xAxisLabel).toBeUndefined(); // undecoded -> auto-derive stands
    expect(panels?.[2].xAxisLabel).toBe("Q (nm-1)"); // real text passes through
  });
});

describe("figureFrameY2Pairs / resolveSpatialPanels (decode-plan #36 residual — PNR/S7/Book33 repro)", () => {
  // Same dataset for every entry in these tests: a real double-Y pair always
  // shares a book (`doubleYPartner`'s own check, reused here).
  const ds = book("d1", "PNR:Book33", {
    origin_book: "Book33",
    x_column_name: "A",
    origin_column_names: ["B", "C", "D"],
  });

  const entry = (
    id: string,
    layer: number,
    figOverrides: Partial<OriginFigure>,
    datasetId: string | null = "d1",
  ): OriginFigureEntry => ({
    id,
    stem: "PNR",
    datasetId,
    siblingIds: [datasetId ?? "none"],
    figure: figure({ name: "Graph24", layer, curves: [{ book: "Book33", x: "A", y: "B" }], ...figOverrides }),
  });

  // Exact frame quads from the real repro (PNR.opj Graph24, 2026-07-09):
  // layer 1 (Reflectivity) sits in its own top frame; layers 2 (Nuclear SLD,
  // host) and 3 (Magnetic SLD, y2) decode BYTE-IDENTICAL frames.
  const topFrame = { left: 867, top: 667, right: 6686, bottom: 2222 };
  const bottomFrame = { left: 867, top: 2701, right: 6686, bottom: 4256 };
  const page = { width: 7582, height: 5127 };

  const reflectivity = entry("f1", 1, {
    frame: topFrame,
    page,
    x_from: 0.008, x_to: 0.075, x_log: false,
    y_from: 8e-6, y_to: 2.0, y_log: true,
  });
  const nuclearSld = entry("f2", 2, {
    frame: bottomFrame,
    page,
    x_from: 2950, x_to: 3550, x_log: false,
    y_from: -1, y_to: 10, y_log: false,
    y_title: "Nuclear SLD",
    curves: [{ book: "Book33", x: "A", y: "C" }], // channel index 1
  });
  const magneticSld = entry("f3", 3, {
    frame: bottomFrame,
    page,
    x_from: 2950, x_to: 3550, x_log: false, // SAME x-range as the host — shares its x axis
    y_from: -0.5, y_to: 2.5, y_log: false, // DIFFERENT y-range — a distinct scale
    y_title: "",
    y2_title: "Magnetic SLD",
    curves: [{ book: "Book33", x: "A", y: "D" }], // channel index 2 — distinct from the host's
  });

  describe("figureFrameY2Pairs", () => {
    it("pairs the frame-coincident host/y2 layers, host = lower layer number", () => {
      const pairs = figureFrameY2Pairs([reflectivity, nuclearSld, magneticSld]);
      expect(pairs).toEqual([{ hostIndex: 1, y2Index: 2 }]);
    });

    it("does not pair when the y-ranges are the same (two real panels, not a double-Y)", () => {
      const sameY = entry("f3", 3, { frame: bottomFrame, page, x_from: 2950, x_to: 3550, y_from: -1, y_to: 10 });
      expect(figureFrameY2Pairs([nuclearSld, sameY])).toEqual([]);
    });

    it("does not pair when the x-ranges differ (not sharing the host's x axis)", () => {
      const differentX = entry("f3", 3, {
        frame: bottomFrame, page, x_from: 0, x_to: 100, y_from: -0.5, y_to: 2.5,
      });
      expect(figureFrameY2Pairs([nuclearSld, differentX])).toEqual([]);
    });

    it("does not pair across different datasets", () => {
      const otherDs = entry("f3", 3, { frame: bottomFrame, page, x_from: 2950, x_to: 3550, y_from: -0.5, y_to: 2.5 }, "d2");
      expect(figureFrameY2Pairs([nuclearSld, otherDs])).toEqual([]);
    });

    it("does not pair when either layer has no decoded curves", () => {
      const noCurves = { ...magneticSld, figure: { ...magneticSld.figure, curves: [] } };
      expect(figureFrameY2Pairs([nuclearSld, noCurves])).toEqual([]);
    });

    it("does not pair frames that merely overlap, rather than coincide (a real geometry conflict)", () => {
      const partiallyOverlapping = entry("f3", 3, {
        frame: { left: 867, top: 3000, right: 6686, bottom: 4500 }, // shifted down — partial overlap only
        page, x_from: 2950, x_to: 3550, y_from: -0.5, y_to: 2.5,
      });
      expect(figureFrameY2Pairs([nuclearSld, partiallyOverlapping])).toEqual([]);
    });

    it("returns [] for a fully spatially-distinct family (no coincident frames at all)", () => {
      const third = entry("f3", 3, {
        frame: { left: 867, top: 4300, right: 6686, bottom: 5000 },
        page, x_from: 0, x_to: 1, y_from: 0, y_to: 1,
      });
      expect(figureFrameY2Pairs([reflectivity, nuclearSld, third])).toEqual([]);
    });
  });

  describe("resolveSpatialPanels", () => {
    it("collapses the PNR/S7/Book33 repro to 2 SPATIAL panels, the second carrying a y2 overlay", () => {
      const result = resolveSpatialPanels([reflectivity, nuclearSld, magneticSld], [ds]);
      expect(result).not.toBeNull();
      expect(result!.spatial).toBe(true);
      expect(result!.layout).toBe("tiled");
      expect(result!.panels).toHaveLength(2); // NOT 3 — layer 3 merged into layer 2's panel
      const [top, bottom] = result!.panels;
      expect(top.row).toBe(0);
      expect(bottom.row).toBe(1); // still a top/bottom 2-stack, not a 1x3 ordinal column
      // The bottom panel carries BOTH layers' channels (Nuclear SLD = C =
      // channel 1, Magnetic SLD = D = channel 2); y2Keys tags layer 3's.
      expect(bottom.yKeys).toEqual([1, 2]);
      expect(bottom.y2Keys).toEqual([2]);
      expect(bottom.y2Lim).toEqual([-0.5, 2.5]);
      expect(bottom.y2Log).toBe(false);
      // Prefers the y2 layer's own y2_title over its (blank) y_title.
      expect(bottom.y2AxisLabel).toBe("Magnetic SLD");
      expect(top.sourceFigureIds).toEqual(["f1"]);
      expect(bottom.sourceFigureIds).toEqual(["f2", "f3"]);
      expect(top.y2Keys ?? null).toBeNull();
    });

    it("leaves a fully spatially-distinct ≥2-layer family as one panel per layer (unmerged, unaffected)", () => {
      const l1 = entry("f1", 1, { frame: { left: 0, top: 0, right: 100, bottom: 45 }, page: { width: 100, height: 100 } });
      const l2 = entry("f2", 2, { frame: { left: 0, top: 55, right: 100, bottom: 100 }, page: { width: 100, height: 100 } });
      const result = resolveSpatialPanels([l1, l2], [ds]);
      expect(result).not.toBeNull();
      expect(result!.panels).toHaveLength(2);
      expect(result!.spatial).toBe(true);
      expect(result!.layout).toBe("tiled");
      expect(result!.panels.every((p) => (p.y2Keys ?? null) === null)).toBe(true);
    });

    it("carries unequal decoded frame proportions into the spatial panel contract", () => {
      const l1 = entry("f1", 1, {
        frame: { left: 0, top: 0, right: 30, bottom: 25 },
        page: { width: 100, height: 100 },
      });
      const l2 = entry("f2", 2, {
        frame: { left: 0, top: 35, right: 30, bottom: 100 },
        page: { width: 100, height: 100 },
      });
      const result = resolveSpatialPanels([l1, l2], [ds]);
      expect(result?.spatial).toBe(true);
      expect(result?.panels.map((p) => p.frameRect)).toEqual([
        { left: 0, top: 0, width: 1, height: 0.25 },
        { left: 0, top: 0.35, width: 1, height: 0.65 },
      ]);
      expect(result?.panels.map((p) => p.layoutAspect)).toEqual([0.3, 0.3]);
    });

    it("falls back to the ordinal stack (unchanged) when frames are missing/degenerate — no merge applies", () => {
      const l1 = entry("f1", 1, { frame: null });
      const l2 = entry("f2", 2, { frame: null });
      const l3 = entry("f3", 3, { frame: null });
      const result = resolveSpatialPanels([l1, l2, l3], [ds]);
      expect(result).not.toBeNull();
      expect(result!.spatial).toBe(false);
      expect(result!.layout).toBe("ordinal");
      expect(result!.panels).toHaveLength(3); // nothing to merge — degenerate geometry, not a real y2 pair
    });

    it("keeps a genuine non-double-Y frame overlap as a trusted page composition", () => {
      // layer 2/3 coincide in frame but have the SAME y-range (two real panels
      // that happen to decode identically) — not a valid y2 pair, so the
      // reduced set still hands computePanelLayout a coincident pair, which
      // rejects a tiled-grid interpretation; the full-page rectangles remain
      // trustworthy and preserve the overlap instead of flattening it.
      const conflictingPair = entry("f3", 3, { frame: bottomFrame, page, x_from: 2950, x_to: 3550, y_from: -1, y_to: 10 });
      const result = resolveSpatialPanels([reflectivity, nuclearSld, conflictingPair], [ds]);
      expect(result).not.toBeNull();
      expect(result!.panels).toHaveLength(3); // no merge -> nothing removed from the layout input
      expect(result!.spatial).toBe(false); // not a tiled grid
      expect(result!.layout).toBe("page"); // trusted overlap remains native page geometry
      expect(result!.panels.every((panel) => panel.pageRect != null)).toBe(true);
      expect(result!.panels[1].pageRect).toEqual(result!.panels[2].pageRect);
    });

    it("returns null (all-or-nothing, unchanged) when any layer fails to resolve a dataset", () => {
      const unresolved = entry("f3", 3, { frame: bottomFrame, page, x_from: 2950, x_to: 3550, y_from: -0.5, y_to: 2.5 }, null);
      expect(resolveSpatialPanels([reflectivity, nuclearSld, unresolved], [ds])).toBeNull();
    });
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

  // Fix #3: the double-Y apply tags the UPPER layer's marks so they plot on
  // y2 rather than the primary axis.
  it("tags the upper layer's marks axis:1 when an axes array is given", () => {
    const l1 = figure({ annotation_marks: [{ text: "lower", x: 1, y: 2 }] });
    const l2 = figure({ annotation_marks: [{ text: "upper", x: 3, y: 4 }] });
    const anns = originFigureAnnotations([l1, l2], "fig-0", [0, 1]);
    expect(anns[0].axis).toBeUndefined(); // lower layer: primary axis, untagged
    expect(anns[1].axis).toBe(1);
  });

  it("leaves every mark untagged (primary) when no axes array is given", () => {
    const l1 = figure({ annotation_marks: [{ text: "lower", x: 1, y: 2 }] });
    const l2 = figure({ annotation_marks: [{ text: "upper", x: 3, y: 4 }] });
    const anns = originFigureAnnotations([l1, l2], "fig-0");
    expect(anns.every((a) => a.axis === undefined)).toBe(true);
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

describe("originLegendFrameXY (decode #52 — faithful in-frame anchor)", () => {
  const base = { x_from: 0, x_to: 10, x_log: false, y_from: 0, y_to: 100, y_log: false };

  it("recovers the box top-left frame fraction (fx from left, fy DOWN from top)", () => {
    // A high box: x=8 -> fx 0.8; y=75 -> 0.75 up from bottom -> 0.25 down from top.
    expect(originLegendFrameXY({ ...base, legend_pos: { x: 8, y: 75 } })).toEqual([0.8, 0.25]);
    // A low box: y=25 -> 0.25 up -> 0.75 down from top.
    expect(originLegendFrameXY({ ...base, legend_pos: { x: 1, y: 25 } })).toEqual([0.1, 0.75]);
  });

  it("interpolates in log10 space on a log axis (matches the decode's model)", () => {
    // y in [1, 1e6] log: y=1e3 -> half up -> 0.5 down from top; x in [18,100].
    expect(
      originLegendFrameXY({
        x_from: 18, x_to: 100, x_log: false, y_from: 1, y_to: 1e6, y_log: true,
        legend_pos: { x: 59, y: 1e3 },
      }),
    ).toEqual([0.5, 0.5]);
  });

  it("returns null OUTSIDE the frame rather than clamp-guessing (corner-snap takes over)", () => {
    expect(originLegendFrameXY({ ...base, legend_pos: { x: 12, y: 50 } })).toBeNull(); // fx 1.2
    expect(originLegendFrameXY({ ...base, legend_pos: { x: 5, y: 120 } })).toBeNull(); // above top
    expect(originLegendFrameXY({ ...base, legend_pos: { x: 5, y: -5 } })).toBeNull(); // below bottom
  });

  it("returns null when no position decoded or the range is degenerate/non-finite", () => {
    expect(originLegendFrameXY({ ...base, legend_pos: null })).toBeNull();
    expect(originLegendFrameXY({ ...base })).toBeNull();
    expect(
      originLegendFrameXY({ ...base, x_from: 5, x_to: 5, legend_pos: { x: 5, y: 50 } }),
    ).toBeNull();
  });
});

describe("originLegendState (decode #52)", () => {
  const base = { x_from: 0, x_to: 10, x_log: false, y_from: 0, y_to: 100, y_log: false };

  it("carries the decoded corner, the legend title AND the frame anchor together", () => {
    expect(originLegendState({ ...base, legend_pos: { x: 8, y: 75 }, legend_title: "Nb/Au" })).toEqual({
      legendPos: "ne",
      legendTitle: "Nb/Au",
      legendFrameXY: [0.8, 0.25],
    });
  });

  it("always sets legendTitle + legendFrameXY (null when absent) so stale state is cleared on re-apply", () => {
    expect(originLegendState({ ...base, legend_pos: { x: 1, y: 25 } })).toEqual({
      legendPos: "sw",
      legendTitle: null,
      legendFrameXY: [0.1, 0.75],
    });
    // No decoded position -> legendPos omitted (never guessed), title + anchor null.
    expect(originLegendState({ ...base, legend_title: "S" })).toEqual({
      legendTitle: "S",
      legendFrameXY: null,
    });
    expect(originLegendState({ ...base })).toEqual({ legendTitle: null, legendFrameXY: null });
    // Out-of-frame position (x=8 in a [0,4] frame -> fx 2.0) -> corner-snap only.
    expect(originLegendState({ ...base, legend_pos: { x: 8, y: 75 }, x_to: 4 })).toEqual({
      legendPos: "ne",
      legendTitle: null,
      legendFrameXY: null,
    });
  });
});

describe("figureSelectionState (decode #52 — store-ratchet extraction)", () => {
  it("spreads the channel selection when present, or {} to leave the default view", () => {
    const sel = { xKey: 0, yKeys: [1, 2], styles: { 1: { color: "#111" } }, labels: { 1: "L" }, errKeys: {}, hiddenChannels: [] };
    expect(figureSelectionState(sel)).toEqual({
      xKey: 0,
      yKeys: [1, 2],
      seriesStyles: { 1: { color: "#111" } },
      seriesLabels: { 1: "L" },
    });
    expect(figureSelectionState(null)).toEqual({});
  });
});

describe("originRegionShades (decode-plan #41)", () => {
  const shades = [
    { x1: 2950, x2: 3000, y1: -1, y2: 10, fill: "#C0C0C0" },
    { x1: 3000, x2: 3090, y1: -1, y2: 10, fill: "#FF8000" },
  ];

  it("maps decoded region_shades to store RegionShades with generated ids", () => {
    const got = originRegionShades([figure({ region_shades: shades })], "fig-key");
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual({
      id: "figshade-fig-key-0-0",
      x1: 2950, x2: 3000, y1: -1, y2: 10, fill: "#C0C0C0",
    });
    expect(new Set(got.map((s2) => s2.id)).size).toBe(2);
  });

  it("skips a shade whose fill never decoded (never guessed) or with a non-finite extent", () => {
    const got = originRegionShades(
      [figure({ region_shades: [
        { x1: 0, x2: 1, y1: 0, y2: 1, fill: null },
        { x1: 0, x2: NaN, y1: 0, y2: 1, fill: "#FF0000" },
        { x1: 0, x2: 1, y1: 0, y2: 1, fill: "#0000FF" },
      ] })],
      "k",
    );
    expect(got).toHaveLength(1);
    expect(got[0].fill).toBe("#0000FF");
  });

  it("returns [] for figures without shades (clears the plot on apply)", () => {
    expect(originRegionShades([figure()], "k")).toEqual([]);
    expect(originRegionShades([figure({ region_shades: [] })], "k")).toEqual([]);
  });

  it("tags the upper layer's shades axis:1 in a double-Y apply", () => {
    const l1 = figure({ region_shades: [shades[0]] });
    const l2 = figure({ region_shades: [shades[1]] });
    const got = originRegionShades([l1, l2], "fig-0", [0, 1]);
    expect(got[0].axis).toBeUndefined();
    expect(got[1].axis).toBe(1);
  });
});

describe("curveDisplayName (Origin %(n) resolution — comment first)", () => {
  // Validated on PNR.opj Graph1 (live-COM PNG oracle): Origin's auto legend
  // shows the bound column's COMMENT ("Nuclear SLD"/"1.5 mT from 700mT"),
  // not its long name ("rho"/"rhoM") — see curveDisplayName's doc.
  const ds = book("b1", "PNR:Book4", {
    origin_book: "Book4",
    x_column_name: "A",
    origin_column_names: ["B", "C", "D"],
    column_comments: { B: "Nuclear SLD", D: "1.5 mT from 700mT" },
  });
  ds.data.labels = ["rho", "drho", "rhoM"];

  it("prefers the column comment, falls back to the long name, then the letter", () => {
    expect(curveDisplayName(ds, "B", 0)).toBe("Nuclear SLD");
    expect(curveDisplayName(ds, "C", 1)).toBe("drho"); // no comment -> long name
    expect(curveDisplayName(ds, "D", 2)).toBe("1.5 mT from 700mT");
  });

  it("falls back to the column letter when neither comment nor label exists", () => {
    const bare = book("b2", "X", { origin_column_names: ["B"] });
    bare.data.labels = [""];
    expect(curveDisplayName(bare, "B", 0)).toBe("B");
  });

  it("threads comments into figureChannelSelection's %(n) resolution", () => {
    const fig = figure({
      curves: [{ book: "Book4", x: "A", y: "D" }],
      legend_labels: ["%(1)"],
    });
    const sel = figureChannelSelection(fig, ds);
    expect(sel?.labels).toEqual({ 2: "1.5 mT from 700mT" });
  });
});
