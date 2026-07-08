import { describe, expect, it } from "vitest";

import { centralDifference, sortByX } from "./differentiate";

describe("sortByX", () => {
  it("sorts (x, y) ascending by x", () => {
    expect(sortByX([2, 0, 1], [20, 0, 10])).toEqual({ x: [0, 1, 2], y: [0, 10, 20] });
  });

  it("is a no-op for already-sorted input", () => {
    expect(sortByX([0, 1, 2], [0, 10, 20])).toEqual({ x: [0, 1, 2], y: [0, 10, 20] });
  });

  it("truncates to the shorter of x/y", () => {
    expect(sortByX([2, 0, 1], [20, 0])).toEqual({ x: [0, 2], y: [0, 20] });
  });
});

describe("centralDifference", () => {
  it("returns the exact slope for a straight line (uniform spacing)", () => {
    const r = centralDifference([0, 1, 2, 3], [0, 2, 4, 6]);
    expect(r).not.toBeNull();
    expect(r!.dydx).toEqual([2, 2, 2, 2]);
    expect(r!.extremumDydx).toBe(2);
  });

  it("matches MATLAB gradient's non-uniform weighted formula", () => {
    // x = [0, 1, 3]; y = x^2 -> [0, 1, 9]. Interior point uses the weighted
    // central-difference formula, not a naive (y2-y0)/(x2-x0).
    const r = centralDifference([0, 1, 3], [0, 1, 9]);
    expect(r).not.toBeNull();
    // endpoints: forward/backward difference
    expect(r!.dydx[0]).toBeCloseTo(1, 10); // (1-0)/(1-0)
    expect(r!.dydx[2]).toBeCloseTo(4, 10); // (9-1)/(3-1)
    // interior weighted central difference (h1=1, h2=2)
    const h1 = 1;
    const h2 = 2;
    const expected = (h1 ** 2 * 9 + (h2 ** 2 - h1 ** 2) * 1 - h2 ** 2 * 0) / (h1 * h2 * (h1 + h2));
    expect(r!.dydx[1]).toBeCloseTo(expected, 10);
  });

  it("un-permutes the result back to the caller's original (unsorted) order", () => {
    // Rows arrive in acquisition order (e.g. a swept-back scan): x = [2, 0, 1],
    // y = x^2 = [4, 0, 1] — a non-linear function so each sample's slope
    // differs and a permutation bug would be observable.
    const r = centralDifference([2, 0, 1], [4, 0, 1]);
    expect(r).not.toBeNull();
    // Row 1 (x=0) is the sorted-order LEFT endpoint: forward diff (1-0)/(1-0)=1.
    expect(r!.dydx[1]).toBeCloseTo(1, 10);
    // Row 2 (x=1) is the sorted-order INTERIOR point (h1=1,h2=1): (4-0)/2=2.
    expect(r!.dydx[2]).toBeCloseTo(2, 10);
    // Row 0 (x=2) is the sorted-order RIGHT endpoint: backward diff (4-1)/(2-1)=3.
    expect(r!.dydx[0]).toBeCloseTo(3, 10);
  });

  it("finds the extremum (largest |dy/dx|) within the region", () => {
    // An asymmetric ramp: steepest exactly at x=2, flatter and unequal either
    // side (avoids a tie between two interior points).
    const x = [0, 1, 2, 3, 4];
    const y = [0, 0, 5, 10, 10];
    const r = centralDifference(x, y);
    expect(r).not.toBeNull();
    expect(r!.extremumX).toBe(2);
    expect(r!.extremumDydx).toBeCloseTo(5, 10);
  });

  it("returns null for fewer than 2 points", () => {
    expect(centralDifference([], [])).toBeNull();
    expect(centralDifference([1], [1])).toBeNull();
  });

  it("yields NaN (not Infinity) at a degenerate duplicate-x sample", () => {
    const r = centralDifference([0, 0, 1], [0, 5, 10]);
    expect(r).not.toBeNull();
    // The two-point endpoint difference (0,0)->(0,5) has zero spacing.
    expect(Number.isNaN(r!.dydx[0]) || Number.isNaN(r!.dydx[1])).toBe(true);
  });
});
