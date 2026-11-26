// Item 22: the axis scroller's model: extents through the row-state model,
// the slider <-> window mapping, clamping and reversed axes.

import { describe, expect, it } from "vitest";

import { dataExtents, scrollFraction, scrolledWindow } from "./axisScroll";
import type { Dataset } from "./types";

const ds = (excluded?: number[]): Dataset => ({
  id: "a",
  name: "A",
  data: { time: [0, 1, 2, 3, 4], values: [[10], [20], [30], [40], [1000]], labels: ["Y"], units: [""], metadata: {} },
  ...(excluded ? { excludedRows: excluded } : {}),
});

describe("dataExtents", () => {
  it("spans the plotted rows", () => {
    expect(dataExtents(ds(), null, [0], null, [], [])).toEqual({ x: [0, 4], y: [10, 1000] });
  });
  it("leaves out an excluded row (row-state model), so the scroller spans what is drawn", () => {
    expect(dataExtents(ds([4]), null, [0], null, [], [])).toEqual({ x: [0, 3], y: [10, 40] });
  });
  it("has no extent when every curve is hidden", () => {
    expect(dataExtents(ds(), null, [0], null, [0], [])).toEqual({ x: null, y: null });
  });
});

describe("scroll mapping", () => {
  it("round-trips and clamps", () => {
    const extent = [0, 10] as const;
    expect(scrollFraction([2, 4], extent)).toBeCloseTo(0.25);
    expect(scrolledWindow([2, 4], extent, 0.25)).toEqual([2, 4]);
    expect(scrolledWindow([2, 4], extent, 1)).toEqual([8, 10]);
    expect(scrolledWindow([2, 4], extent, -3)).toEqual([0, 2]);
  });
  it("keeps a reversed axis reversed and its width", () => {
    expect(scrolledWindow([4, 2], [0, 10], 0)).toEqual([2, 0]);
  });
  it("has nothing to scroll when the window covers the data", () => {
    expect(scrollFraction([-1, 11], [0, 10])).toBeNull();
    expect(scrollFraction([0, 10], [0, 10])).toBeNull();
  });
});
