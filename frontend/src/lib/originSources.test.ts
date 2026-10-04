import { describe, expect, it } from "vitest";

import type { OriginFigureEntry } from "./originFigures";
import {
  originFigureWithSourceMappings,
  previewOriginSourceMapping,
  resolveOriginFigureSources,
  resolveOriginSourceManually,
} from "./originSources";
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

  it("reports a decoded curve column with no numeric data instead of treating it as renderable", () => {
    const emptyY = dataset("d1", "Book1");
    emptyY.data.values = [[Number.NaN, 1], [Number.NaN, 2]];
    const e = entry(figure([{ book: "Book1", x: "A", y: "B" }]));
    const result = resolveOriginFigureSources(e, [e], [emptyY]);
    expect(result.sources).toEqual([]);
    expect(result.unresolved).toEqual([
      { book: "Book1", x: "A", y: "B", reason: "y_column_has_no_numeric_data" },
    ]);
    // Inspection can still reveal the empty saved column; rebuilding cannot
    // advertise a plot that is known to contain no points.
    expect(resolveOriginSourceManually(e, [e], emptyY)).not.toBeNull();
    expect(resolveOriginSourceManually(e, [e], emptyY, { requireFinite: true })).toBeNull();
  });

  it("uses raw letters only after the user explicitly chooses a workbook", () => {
    const e = entry(figure([{ book: "MissingBook", x: "A", y: "B" }]), ["d1"]);
    const chosen = resolveOriginSourceManually(e, [e], dataset("d1", "Book1"));
    expect(chosen).toMatchObject({ datasetId: "d1", xColumns: [-1], yColumns: [0] });
  });

  it("previews the complete repeated-book scope and fails closed on one incompatible binding", () => {
    const good = entry(figure([{ book: "Missing", x: "A", y: "B" }]), ["d1"]);
    const bad = { ...entry(figure([{ book: "Missing", x: "A", y: "Z" }]), ["d1"]), id: "f2" };
    const preview = previewOriginSourceMapping([good, bad], dataset("d1", "Book1"), "Missing");
    expect(preview).toMatchObject({
      entryIds: ["f1", "f2"], bindingCount: 2, canApply: false,
      incompatible: [{ book: "Missing", x: "A", y: "Z", reason: "y_column_not_decoded" }],
    });
  });

  it("does not accept an arbitrary non-Origin dataset as a recovery source", () => {
    const e = entry(figure([{ book: "Missing", x: "A", y: "B" }]), ["d1"]);
    const ordinary = dataset("d1", "Book1");
    delete ordinary.data.metadata!.origin_book;

    expect(previewOriginSourceMapping([e], ordinary, "Missing")).toMatchObject({
      canApply: false,
      incompatible: [{ book: "Missing", x: "A", y: "B", reason: "book_not_imported" }],
    });
  });

  it("requires an explicit choice for a blank saved-book name instead of matching absent metadata", () => {
    const e = entry(figure([{ book: "", x: "A", y: "B" }]), ["d1"]);
    const ordinary = dataset("d1", "Book1");
    delete ordinary.data.metadata!.origin_book;

    expect(resolveOriginFigureSources(e, [e], [ordinary]).unresolved).toEqual([
      { book: "", x: "A", y: "B", reason: "book_not_imported" },
    ]);
  });

  it("resolves only through an explicit saved mapping and projects it without rewriting the stored figure", () => {
    const raw = entry(figure([{ book: "Missing", x: "A", y: "B" }]), ["d1"]);
    const mapped = { ...raw, sourceOverrides: { Missing: "d1" } };
    const ds = dataset("d1", "Book1");
    expect(resolveOriginFigureSources(raw, [raw], [ds]).unresolved[0].reason).toBe("book_not_imported");
    expect(resolveOriginFigureSources(mapped, [mapped], [ds]).unresolved).toEqual([]);
    expect(originFigureWithSourceMappings(mapped, [ds]).figure.curves?.[0].book).toBe("Book1");
    expect(mapped.figure.curves?.[0].book).toBe("Missing");
  });

  it("fails closed when a persisted mapping points at a dataset that is no longer an Origin book", () => {
    const ds = dataset("d1", "Book1");
    delete ds.data.metadata!.origin_book;
    const mapped = {
      ...entry(figure([{ book: "Missing", x: "A", y: "B" }]), ["d1"]),
      datasetId: null,
      sourceOverrides: { Missing: "d1" },
    };

    expect(resolveOriginFigureSources(mapped, [mapped], [ds])).toMatchObject({
      sources: [],
      unresolved: [{ book: "Missing", reason: "book_not_imported" }],
    });
    expect(originFigureWithSourceMappings(mapped, [ds]).datasetId).toBeNull();
  });

  it("fails closed when a persisted mapping no longer matches the worksheet columns", () => {
    const ds = dataset("d1", "Book1");
    const mapped = {
      ...entry(figure([{ book: "Missing", x: "A", y: "NotThere" }]), ["d1"]),
      datasetId: null,
      sourceOverrides: { Missing: "d1" },
    };

    expect(resolveOriginFigureSources(mapped, [mapped], [ds])).toMatchObject({
      sources: [],
      unresolved: [{ book: "Missing", reason: "y_column_not_decoded" }],
    });
    expect(originFigureWithSourceMappings(mapped, [ds])).toMatchObject({
      datasetId: null,
      figure: { curves: [{ book: "Missing", y: "NotThere" }] },
    });
  });
});
