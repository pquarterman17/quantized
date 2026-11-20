import { describe, expect, it } from "vitest";
import { figureChannelSelection, figureCurveErrKeys, withCurveErrKeys } from "./originFigureSelection";
import { buildOverlayDataset, overlayErrorState } from "./originOverlayFigure";
import type { Dataset, OriginFigure } from "./types";

// Origin error-bar plots (io/origin_project/opju_error_bars.py) arrive as
// `OriginCurve.yErr`: the column the curve's own bars draw from.

const figure = (curves: OriginFigure["curves"]): OriginFigure => ({
  name: "Graph1", x_from: 0, x_to: 3, x_log: false, y_from: 0, y_to: 10, y_log: false,
  n_curves: curves?.length ?? 0, annotations: [], curves,
});

const book = (id: string, name: string, letters: string[], designations: Record<string, string> = {}): Dataset => ({
  id,
  name,
  data: {
    time: [0, 1, 2],
    values: [[1, 0.1, 2, 0.2], [2, 0.1, 3, 0.2], [3, 0.1, 4, 0.2]].map((r) => r.slice(0, letters.length)),
    labels: letters,
    units: letters.map(() => ""),
    metadata: { origin_book: name, x_column_name: "A", origin_column_names: letters, column_designations: designations },
  },
});

describe("figureCurveErrKeys", () => {
  it("maps each curve's yErr column onto its own channel", () => {
    const ds = book("d1", "Book1", ["B", "C", "D", "E"]);
    const fig = figure([{ book: "Book1", x: "A", y: "B", yErr: "C" }, { book: "Book1", x: "A", y: "D" }]);
    expect(figureCurveErrKeys(fig, ds)).toEqual({ 0: 1 });
  });

  it("ignores another book's curve and a column the dataset does not hold", () => {
    const ds = book("d1", "Book1", ["B", "C"]);
    const fig = figure([{ book: "Book2", x: "A", y: "B", yErr: "C" }, { book: "Book1", x: "A", y: "B", yErr: "Z" }]);
    expect(figureCurveErrKeys(fig, ds)).toEqual({});
  });
});

describe("withCurveErrKeys", () => {
  it("lets the figure's binding win and drops a designation pairing of the same column", () => {
    // designations paired error channel 1 with channel 2; Origin draws it on 0
    expect(withCurveErrKeys({ 2: 1, 3: 4 }, { 0: 1 })).toEqual({ 0: 1, 3: 4 });
  });
});

describe("figureChannelSelection with yErr", () => {
  it("binds the bars and hides a Y-designated error column", () => {
    const ds = book("d1", "Book1", ["B", "C", "D"], { B: "Y", C: "Y", D: "Y" });
    const sel = figureChannelSelection(figure([{ book: "Book1", x: "A", y: "B", yErr: "C" }, { book: "Book1", x: "A", y: "D" }]), ds);
    expect(sel?.yKeys).toEqual([0, 2]);
    expect(sel?.errKeys).toEqual({ 0: 1 });
    expect(sel?.hiddenChannels).toEqual([1]);
  });
});

describe("overlay error columns", () => {
  it("carries a cross-book curve's bars as a hidden column right after it", () => {
    const a = book("d1", "Book1", ["B", "C"]);
    const b = book("d2", "Book2", ["B"]);
    const fig = figure([{ book: "Book1", x: "A", y: "B", yErr: "C" }, { book: "Book2", x: "A", y: "B" }]);
    const data = buildOverlayDataset(fig, [a, b]);
    expect(data?.labels).toEqual(["Book1: B", "Book1: C", "Book2: B"]);
    expect(overlayErrorState(data)).toEqual({ errKeys: { 0: 1 }, errorColumns: [1] });
    // the error column's values sit in its curve's own block
    expect(data?.values.slice(0, 3).map((r) => r[1])).toEqual([0.1, 0.1, 0.1]);
  });

  it("is empty for an overlay without Origin error bars", () => {
    const fig = figure([{ book: "Book1", x: "A", y: "B" }, { book: "Book2", x: "A", y: "B" }]);
    const data = buildOverlayDataset(fig, [book("d1", "Book1", ["B"]), book("d2", "Book2", ["B"])]);
    expect(overlayErrorState(data)).toEqual({ errKeys: {}, errorColumns: [] });
  });
});
