// B-37 (owner decision 2026-11-24): a worksheet-filtered Origin curve draws
// only the rows its proven condition keeps, through the overlay; the plain
// channel-selection path never draws it with all rows.

import { describe, expect, it } from "vitest";

import { figureChannelSelection } from "./originFigureSelection";
import { buildOverlayDataset } from "./originOverlayFigure";
import { hasRowFilter, keptRows, rowFilteredViews, rowPasses, type OriginRowFilter } from "./originRowFilter";
import type { Dataset, OriginFigure } from "./types";

const GT: OriginRowFilter = { column: "A", op: ">", value: 0, inclusive: false };

const figure = (curves: OriginFigure["curves"]): OriginFigure => ({
  name: "Graph1", x_from: -2, x_to: 3, x_log: false, y_from: 0, y_to: 10, y_log: false,
  n_curves: curves?.length ?? 0, annotations: [], curves,
});

// X deliberately non-monotonic: the kept rows must keep their stored order.
const book = (id: string, origin_book: string): Dataset => ({
  id,
  name: `IFN:${origin_book}`,
  data: {
    time: [2, -1, 0, 1, -2, 3],
    values: [[20, 0.1], [10, 0.2], [0, 0.3], [11, 0.1], [5, 0.5], [30, 0.4]],
    labels: ["I-long", "D-long"],
    units: ["", ""],
    metadata: {
      origin_book, x_column_name: "A", origin_column_names: ["I", "D"],
      origin_text_columns: { T: ["a", "b", "c", "d", "e", "f"] },
    },
  },
});

describe("row filter evaluation", () => {
  it("strict > rejects a tie and every non-finite value", () => {
    expect([1, 0, -1, NaN, Infinity].map((v) => rowPasses(v, GT))).toEqual([true, false, false, false, false]);
    expect(rowPasses(0, { ...GT, inclusive: true })).toBe(true);
    expect(rowPasses(0.05, { column: "D", op: "<", value: 0.1, inclusive: false })).toBe(true);
  });

  it("reads the X column from time and a value column by its short name", () => {
    const b = book("b1", "Book1");
    expect(keptRows(b, GT)).toEqual([0, 3, 5]);
    expect(keptRows(b, { column: "D", op: "<", value: 0.2, inclusive: true })).toEqual([0, 1, 3]);
  });

  it("fails closed on an unknown column or comparison", () => {
    const b = book("b1", "Book1");
    expect(keptRows(b, { ...GT, column: "Z" })).toBeNull();
    expect(keptRows(b, { ...GT, op: "=" as unknown as ">" })).toBeNull();
    expect(keptRows(b, { ...GT, inclusive: null as unknown as boolean })).toBeNull();
  });

  it("one copy per (book, condition), its row-indexed sidecars sliced with it", () => {
    const view = rowFilteredViews();
    const b = book("b1", "Book1");
    const a = view(b, GT);
    expect(a).toBe(view(b, { ...GT }));
    expect(a!.data.time).toEqual([2, 1, 3]);
    expect(b.data.time).toHaveLength(6); // the book keeps every row
    expect((a!.data.metadata.origin_text_columns as Record<string, string[]>).T).toEqual(["a", "d", "f"]);
    expect(view(b, { ...GT, value: 99 })).toBeNull(); // keeps no row: not drawn
  });
});

describe("row-filtered curves in the apply paths", () => {
  it("the overlay draws only the kept rows, in stored order, even for one curve", () => {
    const fig = figure([{ book: "Book1", x: "A", y: "I", rowFilter: GT }]);
    expect(hasRowFilter(fig)).toBe(true);
    const out = buildOverlayDataset(fig, [book("b1", "Book1")]);
    expect(out!.time).toEqual([2, 1, 3]);
    expect(out!.values.map((r) => r[0])).toEqual([20, 11, 30]);
  });

  it("two filtered books keep their own row subsets; an unfiltered book keeps all rows", () => {
    const fig = figure([
      { book: "Book1", x: "A", y: "I", rowFilter: GT },
      { book: "Book2", x: "A", y: "I" },
    ]);
    const out = buildOverlayDataset(fig, [book("b1", "Book1"), book("b2", "Book2")]);
    expect(out!.time).toEqual([2, 1, 3, 2, -1, 0, 1, -2, 3]);
  });

  it("a curve whose filter cannot be evaluated is skipped, never drawn with all rows", () => {
    const fig = figure([
      { book: "Book1", x: "A", y: "I", rowFilter: { ...GT, column: "Z" } },
      { book: "Book2", x: "A", y: "I" },
    ]);
    const out = buildOverlayDataset(fig, [book("b1", "Book1"), book("b2", "Book2")]);
    expect(out!.labels).toEqual(["Book2: I-long"]); // Book2 alone, every row
    expect(out!.time).toEqual([2, -1, 0, 1, -2, 3]);
  });

  it("the plain channel selection leaves a row-filtered curve out", () => {
    const b = book("b1", "Book1");
    expect(figureChannelSelection(figure([{ book: "Book1", x: "A", y: "I", rowFilter: GT }]), b)).toBeNull();
    const both = figure([
      { book: "Book1", x: "A", y: "I", rowFilter: GT },
      { book: "Book1", x: "A", y: "D" },
    ]);
    expect(figureChannelSelection(both, b)?.yKeys).toEqual([1]);
  });
});
