import { describe, expect, it } from "vitest";

import type { OriginFigureEntry } from "./originFigures";
import { resolveOriginFigureSources, resolveOriginSourceManually } from "./originSources";
import type { Dataset, OriginFigure } from "./types";

const dataset = (id: string, book: string): Dataset => ({
  id,
  name: book,
  data: {
    time: [1, 2],
    values: [[10, 1], [20, 2]],
    labels: ["signal", "error"],
    units: ["", ""],
    metadata: {
      origin_book: book,
      x_column_name: "A",
      origin_column_names: ["B", "C"],
      column_designations: { B: "Y", C: "Y-error" },
    },
  },
});

const figure = (curves: NonNullable<OriginFigure["curves"]>): OriginFigure => ({
  name: "Graph1", x_from: 0, x_to: 1, x_log: false,
  y_from: 0, y_to: 1, y_log: false, n_curves: curves.length,
  annotations: [], curves,
});

const entry = (fig: OriginFigure, siblingIds = ["d1", "d2"]): OriginFigureEntry => ({
  id: "f1", stem: "project", figure: fig, datasetId: "d1", siblingIds,
});

describe("resolveOriginFigureSources", () => {
  it("preserves cross-book curve order and selects exact X/Y/error columns", () => {
    const e = entry(figure([
      { book: "Book2", x: "A", y: "B" },
      { book: "Book1", x: "A", y: "B" },
    ]));
    const result = resolveOriginFigureSources(e, [e], [dataset("d1", "Book1"), dataset("d2", "Book2")]);
    expect(result.sources.map((source) => source.book)).toEqual(["Book2", "Book1"]);
    expect(result.sources[0].columns).toEqual([-1, 0, 1]);
    expect(result.sources[0].errorColumns).toEqual([1]);
    expect(result.unresolved).toEqual([]);
  });

  it("never resolves against a same-named book outside the import siblings", () => {
    const e = entry(figure([{ book: "Book2", x: "A", y: "B" }]), ["d1"]);
    const result = resolveOriginFigureSources(e, [e], [dataset("d1", "Book1"), dataset("foreign", "Book2")]);
    expect(result.sources).toEqual([]);
    expect(result.unresolved[0]).toMatchObject({ book: "Book2", reason: "book_not_imported" });
  });

  it("retains raw letters when a decoded column is absent", () => {
    const e = entry(figure([{ book: "Book1", x: "A", y: "Z" }]));
    const result = resolveOriginFigureSources(e, [e], [dataset("d1", "Book1")]);
    expect(result.unresolved).toEqual([
      { book: "Book1", x: "A", y: "Z", reason: "y_column_not_decoded" },
    ]);
  });

  it("uses raw letters only after the user explicitly chooses a workbook", () => {
    const e = entry(figure([{ book: "MissingBook", x: "A", y: "B" }]), ["d1"]);
    const chosen = resolveOriginSourceManually(e, [e], dataset("d1", "Book1"));
    expect(chosen).toMatchObject({ datasetId: "d1", xColumns: [-1], yColumns: [0] });
  });
});
