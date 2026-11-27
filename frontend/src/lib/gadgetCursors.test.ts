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

describe("computeCursorReadout on sine.csv (acceptance 4, C5)", () => {
  // Rows 39-41 and 158-160 of sine.csv (x 0..9.95, 200 rows). numpy:
  //   x, y = loadtxt("sine.csv", delimiter=",", skiprows=1, unpack=True)
  //   i = argmin(abs(x - 2)) -> 40: (2.01005, -0.79433); j = argmin(abs(x - 8)) -> 159: (7.98995, -0.26863)
  //   (y[j] - y[i]) / (x[j] - x[i]) = 0.08791116908309503; dx = 5.9799, dy = 0.5257
  //   the old chip paired x = 2 and 8 with those y: slope 0.0876167; interpolated y(2) = -0.7754, y(8) = -0.284084
  const sx = [1.9598, 2.01005, 2.0603, 7.9397, 7.98995, 8.0402];
  const sy = [-0.69968, -0.79433, -0.84361, -0.21335, -0.26863, -0.3459];
  it("prints each sample's own x with its y, and takes dx, dy and the slope from those pairs", () => {
    const r = computeCursorReadout(sx, sy, [2, 8])!;
    expect([r.x0, r.y0, r.x1, r.y1]).toEqual([2.01005, -0.79433, 7.98995, -0.26863]);
    expect(r.dx).toBeCloseTo(5.9799, 12);
    expect(r.dy).toBeCloseTo(0.5257, 12);
    expect(r.slope).toBeCloseTo(0.08791116908309503, 12);
  });
  it("never reports the cursor's own x beside a neighbouring sample's y", () => {
    const r = computeCursorReadout(sx, sy, [2, 8])!;
    expect(r.x0).not.toBe(2);
    expect(r.x1).not.toBe(8);
  });
});
