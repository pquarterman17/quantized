import { describe, expect, it } from "vitest";
import { confidenceLimits, fmtLimits, fmtR2, fmtValueErr, isExactFit, roundToError, tCritical, timesTen } from "./fitValueFormat";

describe("fmtValueErr (PDG rounding)", () => {
  it("keeps two figures on an error led by 100-354 and one on 355-949", () => {
    expect(fmtValueErr(2.32711, 0.0123)).toBe("2.327 ± 0.012");
    expect(fmtValueErr(9.0000000001, 0.0123)).toBe("9.000 ± 0.012");
    expect(fmtValueErr(2.32711, 0.0456)).toBe("2.33 ± 0.05");
    expect(fmtValueErr(12.3456, 0.5)).toBe("12.3 ± 0.5");
  });
  it("rounds 950-999 up to one figure of the next power of ten", () => {
    expect(fmtValueErr(1.2345, 0.0967)).toBe("1.23 ± 0.10");
  });
  it("shares one ×10ⁿ exponent at extreme magnitudes", () => {
    expect(fmtValueErr(5.4e-13, 1.4e-13)).toBe("(5.4 ± 1.4)×10⁻¹³");
    expect(fmtValueErr(2.5e6, 1.1e4)).toBe("(2.500 ± 0.011)×10⁶");
  });
  it("rounds to tens when the error is large", () => {
    expect(fmtValueErr(1234, 56)).toBe("1230 ± 60");
  });
  it("an error far below the value's precision never prints a wall of digits", () => {
    expect(roundToError(9, 8.73258e-12)).toBeNull();
    expect(fmtValueErr(9, 8.73258e-12)).toBe("9");
  });
  it("a value with no usable error prints alone at four figures; a missing one is a dash", () => {
    for (const e of [null, undefined, 0, -1, Number.NaN, Infinity]) expect(fmtValueErr(0.123456, e)).toBe("0.1235");
    expect(fmtValueErr(Number.NaN, 1)).toBe("—");
  });
  it("timesTen writes the superscript", () => {
    expect(timesTen(-13)).toBe("×10⁻¹³");
    expect(timesTen(6)).toBe("×10⁶");
  });
});

describe("fmtR2", () => {
  it("shows five decimals, never a bare 1 for a near-perfect fit", () => {
    expect(fmtR2(0.99987)).toBe("0.99987");
    expect(fmtR2(0.9998712)).toBe("0.99987");
    expect(fmtR2(0.999999)).toBe("1 − 1.0e-6");
  });
  it("marks an exact fit", () => {
    expect(fmtR2(1)).toBe("≈1 (exact)");
    expect(fmtR2(1 - 1e-15)).toBe("≈1 (exact)");
    expect(isExactFit(1)).toBe(true);
    expect(isExactFit(0.999)).toBe(false);
  });
  it("a missing R² is a dash", () => {
    expect(fmtR2(null)).toBe("—");
  });
});

describe("95 % confidence interval", () => {
  it("matches Student-t critical values", () => {
    expect(tCritical(0.95, 10)).toBeCloseTo(2.22814, 4);
    expect(tCritical(0.95, 1)).toBeCloseTo(12.7062, 3);
    expect(tCritical(0.95, 1000)).toBeCloseTo(1.96234, 4);
    expect(tCritical(0.99, 5)).toBeCloseTo(4.03214, 4);
    expect(tCritical(0.95, 0)).toBeNull();
  });
  it("prints the limits to the error's decimals", () => {
    const [lo, hi] = confidenceLimits(9, 0.012, 10)!;
    expect(hi - lo).toBeCloseTo(2 * 2.22814 * 0.012, 4);
    expect(fmtLimits(9, 0.012, 10)).toBe("[8.973, 9.027]");
    expect(fmtLimits(5.4e-13, 1.4e-13, 10)).toBe("[2.3, 8.5]×10⁻¹³");
  });
  it("is a dash without a dof or a usable error", () => {
    expect(fmtLimits(9, 0.012, 0)).toBe("—");
    expect(fmtLimits(9, null, 10)).toBe("—");
  });
});
