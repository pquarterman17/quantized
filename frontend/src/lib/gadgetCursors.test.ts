import { describe, expect, it } from "vitest";

import { computeCursorReadout, nearestY } from "./gadgetCursors";

const xs = [0, 1, 2, 3, 4];
const ys = [0, 10, 20, 30, 40];

describe("nearestY", () => {
  it("returns the y at the exact matching x", () => {
    expect(nearestY(xs, ys, 2)).toBe(20);
  });

  it("snaps to the nearest sample for an off-grid x", () => {
    expect(nearestY(xs, ys, 2.4)).toBe(20);
    expect(nearestY(xs, ys, 2.6)).toBe(30);
  });

  it("skips non-finite pairs", () => {
    expect(nearestY([0, 1, 2], [Number.NaN, 10, 20], 0)).toBe(10); // snaps past the NaN row
  });

  it("returns null with no finite data", () => {
    expect(nearestY([], [], 0)).toBeNull();
    expect(nearestY([Number.NaN], [Number.NaN], 0)).toBeNull();
  });

  it("does not require sorted x", () => {
    expect(nearestY([4, 0, 2], [40, 0, 20], 2.1)).toBe(20);
  });
});

describe("computeCursorReadout", () => {
  it("computes Δx/Δy/slope between the two cursors' nearest samples", () => {
    const r = computeCursorReadout(xs, ys, [1, 3]);
    expect(r).toEqual({ x0: 1, y0: 10, x1: 3, y1: 30, dx: 2, dy: 20, slope: 10 });
  });

  it("handles a reversed pair (second cursor left of the first)", () => {
    const r = computeCursorReadout(xs, ys, [3, 1]);
    expect(r).toEqual({ x0: 3, y0: 30, x1: 1, y1: 10, dx: -2, dy: -20, slope: 10 });
  });

  it("returns null when a cursor has no data to snap to", () => {
    expect(computeCursorReadout([], [], [1, 3])).toBeNull();
  });

  it("reports a null slope for a vertical (same-x) pair", () => {
    const r = computeCursorReadout(xs, ys, [2, 2]);
    expect(r).toEqual({ x0: 2, y0: 20, x1: 2, y1: 20, dx: 0, dy: 0, slope: null });
  });
});
