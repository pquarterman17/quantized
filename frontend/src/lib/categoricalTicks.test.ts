import { describe, expect, it } from "vitest";
import { categoricalTickFormatter, categoricalXAxis, isCategoryAxis, originCategoryX } from "./categoricalTicks";
import { buildOpts } from "./uplotOpts";
import type { PlotPayload } from "./plotdata";
import type { DataStruct } from "./types";

type Values = (u: never, splits: (number | null)[]) => unknown[];
type Splits = (u: never, i: number, min: number, max: number, incr: number, space: number) => number[];

const cats = ["Low", "Mid", "High"];

describe("categoricalTickFormatter base", () => {
  it("labels 1-based positions of an Origin text X", () => {
    const fn = categoricalTickFormatter(cats, 1) as unknown as Values;
    expect(fn(null as never, [0, 1, 2, 3, 4, 1.5, null])).toEqual(["", "Low", "Mid", "High", "", "", null]);
  });
  it("keeps the 0-based default", () => {
    const fn = categoricalTickFormatter(cats) as unknown as Values;
    expect(fn(null as never, [0, 2, 3])).toEqual(["Low", "High", ""]);
  });
});

describe("categoricalXAxis splits", () => {
  const axis = categoricalXAxis(Array.from({ length: 40 }, (_, i) => `c${i}`), 1, 12);
  const splits = axis.splits as unknown as Splits;
  it("emits only integer positions anchored at the base", () => {
    expect(splits(null as never, 0, 0.5, 6.5, 1, 40)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(splits(null as never, 0, 0.5, 6.5, 0.2, 40)).toEqual([1, 2, 3, 4, 5, 6]); // never sub-integer
  });
  it("thins to every k-th category when uPlot's found increment exceeds 1", () => {
    expect(splits(null as never, 0, 0.5, 40.5, 3, 40)).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40]);
  });
  it("matches the export's step, not uPlot's 1-2-5 increment", () => {
    // Twin of test_export_category_x_axis.py::test_step_is_the_screens_step_for_the_same_geometry:
    // "c0".."c39" at 12 px over 300 px for 40 categories -> 7.5 px per unit, slot 29.6 -> every 4th.
    const twin = categoricalXAxis(Array.from({ length: 40 }, (_, i) => `c${i}`), 1, 12);
    const s = twin.splits as unknown as Splits;
    expect(s(null as never, 0, 0.5, 40.5, 5, 37.5)).toEqual([1, 5, 9, 13, 17, 21, 25, 29, 33, 37]);
    expect(s(null as never, 0, 0.5, 20.5, 2, 30)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]); // zoomed: every 2nd
  });
  it("reserves a label's width between ticks", () => {
    const wide = categoricalXAxis(["a-very-long-category-name"], 1, 12);
    expect(wide.space).toBeGreaterThan(axis.space);
  });
});

describe("originCategoryX", () => {
  const payload = { xCategories: undefined, xLabel: "Row" } as { xCategories?: string[]; xCategoryBase?: number; xLabel: string };
  const ds = (metadata: Record<string, unknown>, time = [1, 2]) => ({ metadata, time }) as unknown as DataStruct;
  it("labels the dataset's own axis with base 1", () => {
    const out = originCategoryX(payload, ds({ x_category_labels: ["a", "b"], x_column_name: "A" }), null);
    expect(out).toMatchObject({ xCategories: ["a", "b"], xCategoryBase: 1, xLabel: "Row" });
  });
  it("titles an unrecovered text X nothing, never the Row placeholder", () => {
    expect(originCategoryX(payload, ds({ x_category_labels: ["a", "b"], x_column_name: "" }), null).xLabel).toBe("");
  });
  it("leaves a channel X, a numeric X and an empty list alone", () => {
    expect(originCategoryX(payload, ds({ x_category_labels: ["a"] }), 0)).toBe(payload);
    expect(originCategoryX(payload, ds({}), null)).toBe(payload);
    expect(originCategoryX(payload, ds({ x_category_labels: [] }), null)).toBe(payload);
  });
  it("leaves a derived X (FFT, bins) that copied the labels a number axis", () => {
    const md = { x_category_labels: ["a", "b", "c"], x_column_name: "" };
    expect(originCategoryX(payload, ds(md, [0, 0.5, 1]), null)).toBe(payload); // FFT frequencies
    expect(originCategoryX(payload, ds(md, [1.5, 2.5]), null)).toBe(payload); // bin centres
    expect(originCategoryX(payload, ds(md, [1, 4]), null)).toBe(payload); // beyond the labels
    expect(originCategoryX(payload, ds(md, [1, 3, NaN]), null).xCategories).toEqual(["a", "b", "c"]); // a row subset
    expect(isCategoryAxis([1, 2], 0)).toBe(false);
  });
});

describe("buildOpts category axis", () => {
  const p: PlotPayload = {
    data: [[1, 2, 3], [5, 6, 7]] as unknown as PlotPayload["data"],
    series: [{ label: "y", unit: "" }],
    xLabel: "x",
    xUnit: "",
    xCategories: cats,
    xCategoryBase: 1,
  };
  it("draws the text at the integer positions and thins through splits", () => {
    const opts = buildOpts(p, { width: 600, height: 400, xScale: "linear", onReadout: () => {}, yScale: "linear", tool: "zoom" } as never);
    const ax = opts.axes?.[0];
    expect((ax?.values as unknown as Values)(null as never, [1, 2, 3])).toEqual(cats);
    expect(typeof ax?.splits).toBe("function");
    expect(typeof ax?.space).toBe("number");
  });
});
