import { describe, expect, it } from "vitest";
import { categoricalTickFormatter, categoricalXAxis, originCategoryX } from "./categoricalTicks";
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
  it("reserves a label's width between ticks", () => {
    const wide = categoricalXAxis(["a-very-long-category-name"], 1, 12);
    expect(wide.space).toBeGreaterThan(axis.space);
  });
});

describe("originCategoryX", () => {
  const payload = { xCategories: undefined } as { xCategories?: string[]; xCategoryBase?: number };
  const ds = (metadata: Record<string, unknown>) => ({ metadata }) as unknown as DataStruct;
  it("labels the dataset's own axis with base 1", () => {
    const out = originCategoryX(payload, ds({ x_category_labels: ["a", "b"] }), null);
    expect(out).toMatchObject({ xCategories: ["a", "b"], xCategoryBase: 1 });
  });
  it("leaves a channel X, a numeric X and an empty list alone", () => {
    expect(originCategoryX(payload, ds({ x_category_labels: ["a"] }), 0)).toBe(payload);
    expect(originCategoryX(payload, ds({}), null)).toBe(payload);
    expect(originCategoryX(payload, ds({ x_category_labels: [] }), null)).toBe(payload);
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
