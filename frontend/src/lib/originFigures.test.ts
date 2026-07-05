import { describe, expect, it } from "vitest";

import {
  buildOriginFigureEntries,
  doubleYPartner,
  figureChannelSelection,
  figureLabel,
  type OriginFigureEntry,
  resolveFigureDataset,
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
