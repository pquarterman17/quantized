import { describe, expect, it } from "vitest";
import { figureChannelSelection, figureCurveErrKeys, withCurveErrKeys } from "./originFigureSelection";
import { curveErrorBindings, figureDocumentErrors } from "./originCurveErrorRoles";
import { originCurveSeriesStyle } from "./originCurveText";
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
    expect(overlayErrorState(data)).toEqual({ errKeys: { 0: 1 }, roles: [], errorColumns: [1] });
    // the error column's values sit in its curve's own block
    expect(data?.values.slice(0, 3).map((r) => r[1])).toEqual([0.1, 0.1, 0.1]);
  });

  it("is empty for an overlay without Origin error bars", () => {
    const fig = figure([{ book: "Book1", x: "A", y: "B" }, { book: "Book2", x: "A", y: "B" }]);
    const data = buildOverlayDataset(fig, [book("d1", "Book1", ["B"]), book("d2", "Book2", ["B"])]);
    expect(overlayErrorState(data)).toEqual({ errKeys: {}, roles: [], errorColumns: [] });
  });
});

// Asymmetric halves, X bars and bands (opju_error_bars.py, lane E2).
describe("asymmetric / X error bars", () => {
  const letters = (l: string) => ["B", "C", "D", "E"].indexOf(l);

  it("binds each half and X bar onto the curve's channel", () => {
    const c = { book: "Book1", x: "A", y: "B", yErrPlus: "C", yErrMinus: "D", xErr: "E" };
    expect(curveErrorBindings(c, 0, letters)).toEqual([
      { channel: 3, target: 0, axis: "x", side: "both" },
      { channel: 1, target: 0, axis: "y", side: "+" },
      { channel: 2, target: 0, axis: "y", side: "-" },
    ]);
  });

  it("drops half a pair, never inventing the other side", () => {
    expect(curveErrorBindings({ book: "Book1", x: "A", y: "B", yErrPlus: "C", yErrMinus: "Z" }, 0, letters)).toEqual([]);
  });

  it("hides the error columns as series in a figure selection", () => {
    const ds = book("d1", "Book1", ["B", "C", "D", "E"], { B: "Y", C: "Y", D: "Y", E: "Y" });
    const sel = figureChannelSelection(figure([{ book: "Book1", x: "A", y: "B", yErrPlus: "C", yErrMinus: "D" }]), ds);
    expect(sel?.yKeys).toEqual([0]);
    expect(sel?.hiddenChannels).toEqual([1, 2]);
  });

  it("merges the figure's bindings over the dataset's richer roles", () => {
    const own = [{ channel: 1, target: 0, axis: "y" as const, side: "+" as const }];
    const roles = [
      { channel: 1, target: -1, axis: "x" as const, side: "both" as const }, // same channel: re-bound
      { channel: 3, target: -1, axis: "x" as const, side: "both" as const }, // kept
    ];
    expect(figureDocumentErrors(own, roles, [], { 2: 4 })).toEqual([
      roles[1], own[0], { channel: 4, target: 2, axis: "y", side: "both" },
    ]);
    // nothing to write: no figure bindings and nothing stale
    expect(figureDocumentErrors([], roles, roles, {})).toBeNull();
    // a previous figure's binding is cleared
    expect(figureDocumentErrors([], roles, own, { 0: 2 })).toEqual([...roles, { channel: 2, target: 0, axis: "y", side: "both" }]);
  });

  it("a filled error plot draws its Y error as a band", () => {
    expect(originCurveSeriesStyle({ style: "line", errBand: true })?.errorBar).toEqual({ band: true });
    expect(originCurveSeriesStyle({ style: "line" })?.errorBar).toBeUndefined();
  });

  it("carries a cross-book curve's halves as hidden overlay columns bound by role", () => {
    const a = book("d1", "Book1", ["B", "C", "D"]);
    const b = book("d2", "Book2", ["B"]);
    const fig = figure([{ book: "Book1", x: "A", y: "B", yErrPlus: "C", yErrMinus: "D" }, { book: "Book2", x: "A", y: "B" }]);
    const data = buildOverlayDataset(fig, [a, b]);
    expect(data?.labels).toEqual(["Book1: B", "Book1: C", "Book1: D", "Book2: B"]);
    const st = overlayErrorState(data);
    expect(st.roles).toEqual([
      { channel: 1, target: 0, axis: "y", side: "+" },
      { channel: 2, target: 0, axis: "y", side: "-" },
    ]);
    expect(st.errorColumns).toEqual([1, 2]);
  });
});
