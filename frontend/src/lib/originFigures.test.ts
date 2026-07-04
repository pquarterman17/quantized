import { describe, expect, it } from "vitest";

import { buildOriginFigureEntries, figureLabel, resolveFigureDataset } from "./originFigures";
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
  it("prefers a surviving annotation over the raw window name", () => {
    const entry = { id: "f1", stem: "XRD", datasetId: "b1", figure: figure({ name: "Graph1", annotations: ["Si (004)"] }) };
    expect(figureLabel(entry)).toBe("Si (004)");
  });

  it("falls back to the window name with no annotations", () => {
    const entry = { id: "f1", stem: "XRD", datasetId: "b1", figure: figure({ name: "Graph3", annotations: [] }) };
    expect(figureLabel(entry)).toBe("Graph3");
  });
});
