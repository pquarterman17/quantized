import { describe, expect, it } from "vitest";

import { clampHigh, clampLow, clampRange, snapToStep } from "./rangeslider";

describe("snapToStep", () => {
  it("passes values through unchanged when step<=0 (continuous)", () => {
    expect(snapToStep(3.14159, 0, 10, 0)).toBeCloseTo(3.14159, 9);
  });

  it("snaps to the nearest step above min", () => {
    expect(snapToStep(3.2, 0, 10, 1)).toBe(3);
    expect(snapToStep(3.6, 0, 10, 1)).toBe(4);
    expect(snapToStep(2.3, 1, 11, 0.5)).toBe(2.5);
  });

  it("clamps into [min, max] after snapping", () => {
    expect(snapToStep(-5, 0, 10, 1)).toBe(0);
    expect(snapToStep(50, 0, 10, 1)).toBe(10);
  });
});

describe("clampLow", () => {
  it("clamps into the domain", () => {
    expect(clampLow(-5, 8, 0, 10)).toEqual({ lo: 0, hi: 8 });
    expect(clampLow(20, 8, 0, 10)).toEqual({ lo: 8, hi: 8 }); // pinned at hi, never crosses
  });

  it("never exceeds the current high value", () => {
    expect(clampLow(9, 5, 0, 10)).toEqual({ lo: 5, hi: 5 });
  });

  it("snaps to step when given", () => {
    expect(clampLow(3.4, 8, 0, 10, 1)).toEqual({ lo: 3, hi: 8 });
  });
});

describe("clampHigh", () => {
  it("clamps into the domain", () => {
    expect(clampHigh(15, 2, 0, 10)).toEqual({ lo: 2, hi: 10 });
    expect(clampHigh(-5, 2, 0, 10)).toEqual({ lo: 2, hi: 2 }); // pinned at lo, never crosses
  });

  it("never goes below the current low value", () => {
    expect(clampHigh(1, 5, 0, 10)).toEqual({ lo: 5, hi: 5 });
  });

  it("snaps to step when given", () => {
    expect(clampHigh(6.6, 2, 0, 10, 1)).toEqual({ lo: 2, hi: 7 });
  });
});

describe("clampRange", () => {
  it("clamps both ends into the domain", () => {
    expect(clampRange(-5, 20, 0, 10)).toEqual({ lo: 0, hi: 10 });
  });

  it("swaps a crossed [lo, hi] pair", () => {
    expect(clampRange(8, 2, 0, 10)).toEqual({ lo: 2, hi: 8 });
  });

  it("snaps both ends to step", () => {
    expect(clampRange(1.4, 8.6, 0, 10, 1)).toEqual({ lo: 1, hi: 9 });
  });
});
