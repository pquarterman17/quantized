import { describe, expect, it } from "vitest";

import { fwhm } from "./peakwidth";

describe("fwhm", () => {
  it("finds a symmetric triangular peak's center + width", () => {
    // baseline 0, apex 10 at x=5; linear up 0→5, down 5→10. Half = 5.
    const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [0, 2, 4, 6, 8, 10, 8, 6, 4, 2, 0];
    const r = fwhm(x, y, 0, 10)!;
    expect(r.center).toBe(5);
    expect(r.height).toBe(10);
    expect(r.baseline).toBe(0);
    expect(r.half).toBe(5);
    // half-max (y=5) crossings: rising between x=2(4) and x=3(6) → 2.5; falling 7.5
    expect(r.x1).toBeCloseTo(2.5, 12);
    expect(r.x2).toBeCloseTo(7.5, 12);
    expect(r.fwhm).toBeCloseTo(5, 12);
  });

  it("accounts for a non-zero baseline", () => {
    // baseline 4, apex 8 at x=2; half = 6.
    const x = [0, 1, 2, 3, 4];
    const y = [4, 6, 8, 6, 4];
    const r = fwhm(x, y, 0, 4)!;
    expect(r.baseline).toBe(4);
    expect(r.height).toBe(8);
    expect(r.half).toBe(6);
    expect(r.x1).toBeCloseTo(1, 12);
    expect(r.x2).toBeCloseTo(3, 12);
    expect(r.fwhm).toBeCloseTo(2, 12);
  });

  it("clamps to the range edge when a side never crosses half", () => {
    // monotonic rising — no right-side crossing; x2 clamps to the last x.
    const x = [0, 1, 2, 3];
    const y = [0, 1, 2, 3];
    const r = fwhm(x, y, 0, 3)!;
    expect(r.center).toBe(3);
    expect(r.x2).toBe(3);
  });

  it("sorts non-monotonic x before walking", () => {
    const x = [5, 4, 3, 2, 1, 0, 6, 7, 8, 9, 10];
    const y = [10, 8, 6, 4, 2, 0, 8, 6, 4, 2, 0];
    const r = fwhm(x, y, 0, 10)!;
    expect(r.center).toBe(5);
    expect(r.fwhm).toBeCloseTo(5, 12);
  });

  it("returns null for fewer than two points or a flat range", () => {
    expect(fwhm([1], [1], 0, 10)).toBeNull();
    expect(fwhm([0, 1, 2], [3, 3, 3], 0, 2)).toBeNull();
  });
});
