import { describe, expect, it } from "vitest";

import { decimalsForIncrement, niceTicks, pow10 } from "./ticks";

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

// MAIN #20 (owner bug report): the floor under any fixed-decimal axis tick
// formatter, so a dense M-H moment axis (splits 0.0001 apart) never renders
// fewer decimals than the increment needs to keep every tick's label
// distinct — see uplotOpts.ts's tickFormatter/autoTickValues for the
// consumer side.
describe("decimalsForIncrement (MAIN #20)", () => {
  it("derives decimals from the log10 order of magnitude for power-of-10 increments", () => {
    expect(decimalsForIncrement(1)).toBe(0);
    expect(decimalsForIncrement(10)).toBe(0);
    expect(decimalsForIncrement(0.1)).toBe(1);
    expect(decimalsForIncrement(0.01)).toBe(2);
    expect(decimalsForIncrement(0.0001)).toBe(4); // the owner's dense-tick spacing
  });

  it("round-trips upward for non-power-of-10 'nice' steps (0.25, 1.25, 2.5e-n)", () => {
    // -log10(0.25) alone implies 1 decimal, which rounds 0.25 to "0.3" —
    // wrong. The round-trip check bumps to the 2 decimals 0.25 actually needs.
    expect(decimalsForIncrement(0.25)).toBe(2);
    expect(decimalsForIncrement(1.25)).toBe(2);
    expect(decimalsForIncrement(0.0025)).toBe(4);
    expect(decimalsForIncrement(0.5)).toBe(1); // 0.5 prints exactly at 1 decimal
  });

  it("returns 0 (no floor) for a non-positive or non-finite increment", () => {
    expect(decimalsForIncrement(0)).toBe(0);
    expect(decimalsForIncrement(-1)).toBe(0);
    expect(decimalsForIncrement(NaN)).toBe(0);
    expect(decimalsForIncrement(Infinity)).toBe(0);
  });

  it("never exceeds maxDecimals", () => {
    expect(decimalsForIncrement(1e-30, 6)).toBeLessThanOrEqual(6);
  });
});
