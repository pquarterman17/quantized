import { describe, expect, it } from "vitest";

import { SUBSTEPS, splineDense, splineEligible } from "./cubicSpline";

// Frozen from `quantized.calc.figure_marks.spline_dense` (scipy CubicSpline,
// bc_type="natural") for x=[1,2,3,4], y=[10,20,15,30]: the export's curve.
const X = [1, 2, 3, 4];
const Y = [10, 20, 15, 30];

describe("splineDense (N6 spline connect)", () => {
  it("samples SUBSTEPS points per segment and passes through every knot", () => {
    const d = splineDense(X, Y)!;
    expect(SUBSTEPS).toBe(16);
    expect(d.x).toHaveLength(3 * 16 + 1);
    expect(d.knots).toEqual([0, 16, 32, 48]);
    d.knots.forEach((k, i) => {
      expect(d.x[k]).toBeCloseTo(X[i], 12);
      expect(d.y[k]).toBeCloseTo(Y[i], 12);
    });
  });

  it("matches the export's scipy natural cubic spline (screen/export agreement)", () => {
    const d = splineDense(X, Y)!;
    expect(d.y[8]).toBeCloseTo(17.0, 10);
    expect(d.y[24]).toBeCloseTo(17.125, 10);
    expect(d.y[40]).toBeCloseTo(20.125, 10);
    expect(d.y[1]).toBeCloseTo(10.95703125, 10);
    expect(d.x[1]).toBeCloseTo(1.0625, 12);
  });

  it("refuses a loop, a tie and a too-short series (drawn straight instead)", () => {
    expect(splineEligible([0, 1, 2, 1, 0], [0, 1, 0, -1, 0])).toBe(false);
    expect(splineEligible([1, 1, 2], [1, 2, 3])).toBe(false);
    expect(splineEligible([1, 2], [1, 2])).toBe(false);
    expect(splineDense([0, 1, 2, 1, 0], [0, 1, 0, -1, 0])).toBeNull();
    expect(splineEligible(X, Y)).toBe(true);
  });

  it("splits at a null/NaN row with one NaN separator", () => {
    const d = splineDense([1, 2, 3, 4, 5, 6, 7], [1, 3, 2, null, 5, 4, 6])!;
    expect(d.y.filter((v) => Number.isNaN(v))).toHaveLength(1);
    expect(d.x.filter((v) => Number.isNaN(v))).toHaveLength(1);
  });
});
