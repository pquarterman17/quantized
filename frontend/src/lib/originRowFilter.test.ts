// B-37 (owner decision 2026-11-24): a worksheet-filtered Origin curve draws
// only the rows its proven condition keeps, through the overlay; the plain
// channel-selection path never draws it with all rows.

import { describe, expect, it } from "vitest";

import { figureChannelSelection } from "./originFigureSelection";
import { buildOverlayDataset } from "./originOverlayFigure";
import { hasRowFilter, keptRows, rowFilteredViews, rowPasses, type OriginRowFilter } from "./originRowFilter";
import { generateFigureThumbnail } from "./thumbnailArtifacts";
import { resolveThumbnailRequest } from "./thumbnailRequest";
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
      // the condition the backend stamped on this book (opju_worksheet_filter)
      origin_worksheet_filter: { column: "time", column_short: "A", op: ">", value: 0, inclusive: false },
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
    const lt: OriginRowFilter = { column: "D", op: "<", value: 0.2, inclusive: true };
    const onD = { ...b, data: { ...b.data, metadata: { ...b.data.metadata, origin_worksheet_filter: { column: "D", column_short: "D", op: "<", value: 0.2, inclusive: true } } } };
    expect(keptRows(onD, lt)).toEqual([0, 1, 3]);
  });

  it("fails closed when the book does not carry that very condition (a re-pointed curve)", () => {
    const b = book("b1", "Book1");
    const bare = { ...b, data: { ...b.data, metadata: { ...b.data.metadata, origin_worksheet_filter: undefined } } };
    expect(keptRows(bare, GT)).toBeNull(); // e.g. a source override onto a CSV with a column "A"
    expect(keptRows(b, { ...GT, value: 1 })).toBeNull(); // another threshold than the book's
    expect(keptRows(b, { ...GT, column: "I" })).toBeNull(); // another column than the book's
  });

  it("fails closed when the filter column holds a non-finite value (e.g. a cell blanked after import)", () => {
    const b = book("b1", "Book1");
    const edited = { ...b, data: { ...b.data, time: [2, -1, NaN, 1, -2, 3] } };
    expect(keptRows(edited, GT)).toBeNull();
    // the evaluation follows the book's CURRENT values: an edit that keeps
    // every cell finite re-selects the rows
    const moved = { ...b, data: { ...b.data, time: [-2, -1, 0, 1, 2, 3] } };
    expect(keptRows(moved, GT)).toEqual([3, 4, 5]);
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
    expect(rowFilteredViews()({ ...b, data: { ...b.data, time: b.data.time.map(() => -5) } }, GT)).toBeNull(); // keeps no row: not drawn
  });

  it("mask + filter: the copy also leaves out the book's excluded rows (B-38), renumbered", () => {
    const b = { ...book("b1", "Book1"), excludedRows: [3, 4] }; // row 3 passes the filter, row 4 does not
    const v = rowFilteredViews()(b, GT)!;
    expect(v.data.time).toEqual([2, 3]);
    expect(v.excludedRows).toBeUndefined(); // never re-applied to the renumbered rows
    expect(rowFilteredViews()({ ...b, excludedRows: [0, 3, 5] }, GT)).toBeNull(); // every kept row excluded
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

  it("a filtered curve over a recorded TEXT X (category positions) is skipped", () => {
    const fig = figure([{ book: "Book1", x: "T", y: "I", xRecorded: true, rowFilter: GT }]);
    expect(buildOverlayDataset(fig, [book("b1", "Book1")])).toBeNull();
  });

  it("mask + filter through the overlay: an excluded row of a filtered book is not drawn", () => {
    const fig = figure([{ book: "Book1", x: "A", y: "I", rowFilter: GT }]);
    const out = buildOverlayDataset(fig, [{ ...book("b1", "Book1"), excludedRows: [5] }]);
    expect(out!.time).toEqual([2, 1]);
    expect(out!.values.map((r) => r[0])).toEqual([20, 11]);
  });

  it("the Library thumbnail never draws a row-filtered text-X curve with all rows", async () => {
    const b = book("b1", "Book1");
    const fig = figure([{ book: "Book1", x: "T", y: "I", xRecorded: true, rowFilter: GT }]);
    const node = {
      key: "origin-figure:of1", entityId: "of1", kind: "origin-figure", name: "Graph1",
      parentKey: null, depth: 0, children: [], entity: { id: "of1", datasetId: "b1", stem: "C", figure: fig },
      source: { datasetIds: ["b1"], missingDatasetIds: [], usedPlacementFallback: false },
    } as never;
    const request = resolveThumbnailRequest(node, { datasets: [b], editableFigures: [] });
    const svg = decodeURIComponent((await generateFigureThumbnail(request, new AbortController().signal)).url.replace("data:image/svg+xml,", ""));
    expect(svg).not.toContain("<polyline");
    // control: the same curve without a row filter IS drawn there
    const plain = figure([{ book: "Book1", x: "T", y: "I", xRecorded: true }]);
    const ctl = resolveThumbnailRequest({ ...(node as object), entity: { id: "of1", datasetId: "b1", stem: "C", figure: plain } } as never, { datasets: [b], editableFigures: [] });
    const ctlSvg = decodeURIComponent((await generateFigureThumbnail(ctl, new AbortController().signal)).url.replace("data:image/svg+xml,", ""));
    expect(ctlSvg).toContain("<polyline");
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
