import { describe, expect, it } from "vitest";

import { niceTicks, pow10 } from "./ticks";

describe("niceTicks", () => {
  it("produces round 1-2-5 values inside the range", () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("snaps fractional ranges to clean steps (the RSM 2theta case)", () => {
    expect(niceTicks(60, 62)).toEqual([60, 60.5, 61, 61.5, 62]);
  });

  it("stays within [lo, hi]", () => {
    const ticks = niceTicks(30.0, 31.0);
    expect(ticks[0]).toBeGreaterThanOrEqual(30.0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(31.0);
  });

  it("handles a tiny range without runaway", () => {
    const ticks = niceTicks(2.115, 2.145);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThan(20);
  });

  it("returns the endpoint for a degenerate range", () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(10, 0)).toEqual([10]);
  });

  it("does not emit float-drift noise", () => {
    // every tick should be a clean multiple of the step (no 61.00000000001).
    for (const v of niceTicks(60, 62)) {
      expect(Number.isInteger(v * 2)).toBe(true); // multiples of 0.5
    }
  });
});

describe("pow10 (exact integer decades)", () => {
  it("returns the correctly-rounded double for every integer exponent, matching the decimal literal", () => {
    // Math.pow(10, k) is not correctly-rounded per spec and drifts on some
    // V8 builds (the 2026-07-10 ubuntu-CI-only 9.999999999999999e-6). The
    // decimal-literal parse IS correctly rounded everywhere — pin that.
    for (let k = -12; k <= 12; k++) {
      expect(pow10(k)).toBe(Number(`1e${k}`));
    }
    expect(pow10(-5)).toBe(0.00001);
    expect(pow10(-4)).toBe(0.0001);
  });

  it("falls back to Math.pow for fractional exponents", () => {
    expect(pow10(0.5)).toBeCloseTo(Math.sqrt(10), 12);
  });
});
