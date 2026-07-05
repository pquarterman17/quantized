import { describe, expect, it } from "vitest";

import { originErrKeys, originHiddenChannels } from "./errorbars";
import { buildOverlayDataset, overlayBooks, overlayCurveStyles } from "./originOverlay";
import type { Dataset, OriginFigure } from "./types";

const figure = (curves: OriginFigure["curves"]): OriginFigure => ({
  name: "Graph1",
  x_from: 0,
  x_to: 10,
  x_log: false,
  y_from: 0,
  y_to: 1,
  y_log: false,
  n_curves: curves?.length ?? 0,
  annotations: [],
  curves,
});

const book = (
  id: string,
  origin_book: string,
  time: number[],
  cols: Record<string, number[]>,
): Dataset => ({
  id,
  name: `XRD:${origin_book}`,
  data: {
    time,
    values: time.map((_, i) => Object.values(cols).map((c) => c[i])),
    labels: Object.keys(cols).map((k) => `${k}-long`),
    units: Object.keys(cols).map(() => "cts"),
    metadata: {
      origin_book,
      x_column_name: "A",
      origin_column_names: Object.keys(cols),
      source_format: "origin-opj",
    },
  },
});

const b1 = book("d1", "Book1", [1, 2, 3], { B: [10, 20, 30] });
const b2 = book("d2", "Book2", [5, 6], { B: [50, 60], C: [7, 8] });

describe("overlayBooks", () => {
  it("collects the unique resolvable books in curve order", () => {
    const fig = figure([
      { book: "Book2", x: "A", y: "B" },
      { book: "Book1", x: "A", y: "B" },
      { book: "Book2", x: "A", y: "C" },
      { book: "Missing", x: "A", y: "B" },
    ]);
    expect(overlayBooks(fig, [b1, b2]).map((d) => d.id)).toEqual(["d2", "d1"]);
  });
});

describe("buildOverlayDataset", () => {
  it("returns null for single-book figures (plain channel selection handles those)", () => {
    const fig = figure([{ book: "Book1", x: "A", y: "B" }]);
    expect(buildOverlayDataset(fig, [b1, b2])).toBeNull();
  });

  it("concatenates per-book x segments and NaN-fills off-segment cells", () => {
    const fig = figure([
      { book: "Book2", x: "A", y: "B" },
      { book: "Book1", x: "A", y: "B" },
    ]);
    const ds = buildOverlayDataset(fig, [b1, b2]);
    expect(ds).not.toBeNull();
    // Book2's block first (first-curve order), then Book1's.
    expect(ds!.time).toEqual([5, 6, 1, 2, 3]);
    expect(ds!.labels).toEqual(["Book2: B-long", "Book1: B-long"]);
    // column 0 = Book2 curve: values in its block, NaN in Book1's
    expect(ds!.values.map((r) => r[0])).toEqual([50, 60, NaN, NaN, NaN]);
    expect(ds!.values.map((r) => r[1])).toEqual([NaN, NaN, 10, 20, 30]);
    expect(ds!.metadata.origin_overlay).toBe(true);
    expect(ds!.metadata.origin_overlay_books).toEqual(["Book2", "Book1"]);
  });

  it("stamps decoded line/scatter styles in column order, recoverable via overlayCurveStyles", () => {
    const fig = figure([
      { book: "Book2", x: "A", y: "B", style: "scatter" }, // overlay col 0
      { book: "Book1", x: "A", y: "B", style: "line" }, // overlay col 1
    ]);
    const ds = buildOverlayDataset(fig, [b1, b2]);
    expect(ds).not.toBeNull();
    expect(ds!.metadata.origin_curve_styles).toEqual([{ marker: true, width: 0 }, { width: 1.5 }]);
    // The store reads them back as a channel-index → SeriesStyle map.
    expect(overlayCurveStyles(ds)).toEqual({ 0: { marker: true, width: 0 }, 1: { width: 1.5 } });
  });

  it("leaves a gap (null) for an undecoded curve style, so unstyled columns take the default", () => {
    const fig = figure([
      { book: "Book2", x: "A", y: "B", style: "scatter" },
      { book: "Book1", x: "A", y: "B" }, // no style → null slot, no override
    ]);
    const ds = buildOverlayDataset(fig, [b1, b2]);
    expect(ds!.metadata.origin_curve_styles).toEqual([{ marker: true, width: 0 }, null]);
    expect(overlayCurveStyles(ds)).toEqual({ 0: { marker: true, width: 0 } }); // col 1 absent
  });

  it("overlayCurveStyles is empty for a non-overlay dataset", () => {
    expect(overlayCurveStyles(b1.data)).toEqual({});
    expect(overlayCurveStyles(null)).toEqual({});
  });

  it("stamps per-column designations so error columns hide + pair on the overlay", () => {
    // Two books, each a Y data column + its adjacent Y-error, plotted together —
    // the shape of a cross-book reflectometry figure (SA + dSA per book).
    const mk = (id: string, bk: string, y: number[], dy: number[]): Dataset => ({
      id,
      name: `R:${bk}`,
      data: {
        time: [1, 2],
        values: [
          [y[0], dy[0]],
          [y[1], dy[1]],
        ],
        labels: ["SA", "dSA"],
        units: ["", ""],
        metadata: {
          origin_book: bk,
          x_column_name: "A",
          origin_column_names: ["B", "C"],
          column_designations: { A: "X", B: "Y", C: "Y-error" },
        },
      },
    });
    const bA = mk("a", "BookA", [1, 2], [0.1, 0.2]);
    const bB = mk("b", "BookB", [3, 4], [0.3, 0.4]);
    const fig = figure([
      { book: "BookA", x: "A", y: "B" }, // c0 = SA_A
      { book: "BookA", x: "A", y: "C" }, // c1 = dSA_A (adjacent after its SA)
      { book: "BookB", x: "A", y: "B" }, // c2 = SA_B
      { book: "BookB", x: "A", y: "C" }, // c3 = dSA_B
    ]);
    const ds = buildOverlayDataset(fig, [bA, bB]);
    expect(ds).not.toBeNull();
    expect(ds!.metadata.origin_column_names).toEqual(["c0", "c1", "c2", "c3"]);
    expect(ds!.metadata.column_designations).toEqual({
      c0: "Y",
      c1: "Y-error",
      c2: "Y",
      c3: "Y-error",
    });
    // The same default-view rules now run on the overlay: error columns hidden,
    // and each dSA pairs to its own SA (left-neighbor, book-grouped order).
    expect(originHiddenChannels(ds!)).toEqual([1, 3]);
    expect(originErrKeys(ds!)).toEqual({ 0: 1, 2: 3 });
  });

  it("preserves non-monotonic x order inside a segment (hysteresis-loop safe)", () => {
    const loop = book("d3", "Loop", [0, 5, 0, -5, 0], { B: [1, 2, 3, 4, 5] });
    const fig = figure([
      { book: "Loop", x: "A", y: "B" },
      { book: "Book1", x: "A", y: "B" },
    ]);
    const ds = buildOverlayDataset(fig, [loop, b1]);
    expect(ds!.time.slice(0, 5)).toEqual([0, 5, 0, -5, 0]); // never sorted
  });

  it("skips curves whose column letter is not a decoded channel", () => {
    const fig = figure([
      { book: "Book1", x: "A", y: "Z" }, // dropped column
      { book: "Book1", x: "A", y: "B" },
      { book: "Book2", x: "A", y: "C" },
    ]);
    const ds = buildOverlayDataset(fig, [b1, b2]);
    expect(ds!.labels).toEqual(["Book1: B-long", "Book2: C-long"]);
  });

  it("returns null when fewer than two curves survive resolution", () => {
    const fig = figure([
      { book: "Book1", x: "A", y: "Z" },
      { book: "Book2", x: "A", y: "B" },
    ]);
    expect(buildOverlayDataset(fig, [b1, b2])).toBeNull();
  });

  it("returns null when survivors collapse onto a single book (other book's column undecoded)", () => {
    // 2 curves survive, but both are Book1's — Book2's column never decoded, so
    // this isn't really an overlay. Must fall through to plain channel selection.
    const bc = book("d4", "Book1", [1, 2, 3], { B: [10, 20, 30], C: [11, 21, 31] });
    const fig = figure([
      { book: "Book1", x: "A", y: "B" },
      { book: "Book1", x: "A", y: "C" }, // 2 survivors, same book
      { book: "Book2", x: "A", y: "Z" }, // undecoded column -> dropped
    ]);
    expect(buildOverlayDataset(fig, [bc, b2])).toBeNull();
  });

  it("uses a non-default x channel for a block when the curve says so", () => {
    const fig = figure([
      { book: "Book2", x: "C", y: "B" }, // plot B against column C
      { book: "Book1", x: "A", y: "B" },
    ]);
    const ds = buildOverlayDataset(fig, [b1, b2]);
    expect(ds!.time.slice(0, 2)).toEqual([7, 8]); // Book2 block x = column C
  });
});
