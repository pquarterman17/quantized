import { describe, expect, it } from "vitest";

import {
  buildOriginFigureEntries,
  figureChannelSelection,
  figureLabel,
  resolveFigureDataset,
} from "./originFigures";
import type { Dataset, OriginFigure } from "./types";

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
    expect(figureChannelSelection(fig, ds)).toEqual({ xKey: null, yKeys: [1] });
  });

  it("selects a non-default x channel when the curve's x is not the dataset x", () => {
    const fig = figure({ curves: [{ book: "Co", x: "B", y: "C" }] });
    expect(figureChannelSelection(fig, ds)).toEqual({ xKey: 0, yKeys: [1] });
  });

  it("collects multiple curves, deduplicated", () => {
    const fig = figure({
      curves: [
        { book: "Co", x: "A", y: "B" },
        { book: "Co", x: "A", y: "C" },
        { book: "Co", x: "A", y: "C" },
      ],
    });
    expect(figureChannelSelection(fig, ds)).toEqual({ xKey: null, yKeys: [0, 1] });
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
    expect(figureChannelSelection(fig, ds)).toEqual({ xKey: null, yKeys: [0] });
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
  });
});

describe("figureLabel", () => {
  it("suffixes layers >= 2 with the layer number", () => {
    const entry = { id: "f1", stem: "M", datasetId: "b1", figure: figure({ name: "Graph4", layer: 2 }) };
    expect(figureLabel(entry)).toBe("Graph4 · layer 2");
    const l1 = { id: "f2", stem: "M", datasetId: "b1", figure: figure({ name: "Graph4", layer: 1 }) };
    expect(figureLabel(l1)).toBe("Graph4");
  });


  it("prefers a surviving annotation over the raw window name", () => {
    const entry = { id: "f1", stem: "XRD", datasetId: "b1", figure: figure({ name: "Graph1", annotations: ["Si (004)"] }) };
    expect(figureLabel(entry)).toBe("Si (004)");
  });

  it("falls back to the window name with no annotations", () => {
    const entry = { id: "f1", stem: "XRD", datasetId: "b1", figure: figure({ name: "Graph3", annotations: [] }) };
    expect(figureLabel(entry)).toBe("Graph3");
  });
});
