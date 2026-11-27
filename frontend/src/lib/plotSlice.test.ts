// Item 22 data slicer, the pure half: the box read back from the painted selection and
// the filter plan, including what it refuses.

import { describe, expect, it } from "vitest";
import type uPlot from "uplot";

import { liveSelectedRows, planSliceFilter, sliceBoxOf } from "./plotSlice";
import type { RebindState } from "./curveRebind";
import type { Dataset } from "./types";

const ds: Dataset = {
  id: "d", name: "D",
  data: { time: [0, 1, 2, 3], values: [[1, 10], [2, 20], [3, 30], [4, 40]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};
const state = (over: Partial<RebindState & { y2Keys: number[] | null }> = {}): RebindState & { y2Keys: number[] | null } => ({
  datasets: [ds], activeId: "d", xKey: null, yKeys: [0], seriesOrder: [], hiddenChannels: [], seriesLabels: {}, workbooks: [], y2Keys: null, ...over,
});
const plain = {} as never;

describe("sliceBoxOf", () => {
  // Value = pixel / 10 on x, 100 - pixel on y; y2 = pixel * 2.
  const u = (select: object, h = 300): uPlot =>
    ({ select, over: { clientHeight: h }, posToVal: (px: number, s: string) => (s === "x" ? px / 10 : s === "y" ? 100 - px : px * 2) }) as unknown as uPlot;
  it("reads a box on each Y axis, with the top edge first", () => {
    const b = sliceBoxOf(u({ left: 20, top: 10, width: 30, height: 40 }), true)!;
    expect(b.x).toEqual([2, 5]);
    expect(b.y).toEqual([90, 50]);
    expect(b.y2).toEqual([20, 100]);
  });
  it("is an X band when it spans the plot's height, and nothing when it is empty", () => {
    expect(sliceBoxOf(u({ left: 20, top: 0, width: 30, height: 300 }), false)).toEqual({ x: [2, 5] });
    expect(sliceBoxOf(u({ left: 20, top: 0, width: 0, height: 0 }), false)).toBeNull();
  });
});

describe("planSliceFilter", () => {
  const box = { x: [3, 1] as [number, number], y: [35, 5] as [number, number], y2: [900, 800] as [number, number] };
  it("filters on X and the one curve's Y, ordering each window", () => {
    const { plan, skippedY } = planSliceFilter(state(), box, plain);
    expect(plan).toMatchObject({ ok: true, edits: [{ datasetId: "d", filter: [{ col: -1, kind: "range", min: 1, max: 3 }, { col: 0, kind: "range", min: 5, max: 35 }] }] });
    expect(skippedY).toBeNull();
  });
  it("uses the Y2 edges for a curve on Y2", () => {
    const { plan } = planSliceFilter(state({ yKeys: [1], y2Keys: [1] }), box, plain);
    expect(plan).toMatchObject({ ok: true, edits: [{ filter: [{ col: -1, min: 1, max: 3 }, { col: 1, min: 800, max: 900 }] }] });
  });
  it("falls back to X alone, saying why, for two curves, a staggered Y, or a box with no edge", () => {
    expect(planSliceFilter(state({ yKeys: [0, 1] }), box, plain).skippedY).toMatch(/exactly one visible curve/);
    const stag = planSliceFilter(state(), box, { yShift: [0, 5] } as never);
    expect(stag.skippedY).toMatch(/staggered/);
    expect(stag.plan).toMatchObject({ ok: true, edits: [{ filter: [{ col: -1 }] }] });
    expect(planSliceFilter(state({ yKeys: [1], y2Keys: [1] }), { x: [1, 3], y: [5, 35] }, plain).skippedY).toMatch(/no edge/);
    expect(planSliceFilter(state(), { x: [1, 3] }, plain).skippedY).toBeNull();
  });
  it("refuses a display whose X is not the data's", () => {
    expect(planSliceFilter(state(), box, { blockRows: 2 } as never).plan).toMatchObject({ ok: false });
    expect(planSliceFilter(state(), box, { xCategories: ["a"] } as never).plan).toMatchObject({ ok: false });
  });
});

describe("liveSelectedRows", () => {
  it("drops masked and filtered rows, de-duplicates and sorts", () => {
    expect(liveSelectedRows([5, 1, 3, 1, 4], new Set([3]), new Set([4]))).toEqual([1, 5]);
  });
});
