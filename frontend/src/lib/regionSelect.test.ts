import { describe, expect, it } from "vitest";

import { normalizeRange, withYRange, type RegionPick } from "./regionSelect";

describe("normalizeRange", () => {
  it("orders endpoints regardless of drag direction", () => {
    expect(normalizeRange(3, 7)).toEqual([3, 7]);
    expect(normalizeRange(7, 3)).toEqual([3, 7]); // right-to-left drag
  });

  it("returns null for a zero-span click", () => {
    expect(normalizeRange(5, 5)).toBeNull();
  });

  it("returns null for non-finite input", () => {
    expect(normalizeRange(Number.NaN, 5)).toBeNull();
    expect(normalizeRange(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("clamps both edges into bounds", () => {
    // Drag overshoots the data extent on both ends -> pinned to [0, 10].
    expect(normalizeRange(-3, 14, { min: 0, max: 10 })).toEqual([0, 10]);
    // Overshoots only the left.
    expect(normalizeRange(-3, 6, { min: 0, max: 10 })).toEqual([0, 6]);
  });

  it("clamps a one-sided bound", () => {
    expect(normalizeRange(2, 8, { min: 5 })).toEqual([5, 8]);
    expect(normalizeRange(2, 8, { max: 5 })).toEqual([2, 5]);
  });

  it("returns null when the selection lies entirely outside bounds", () => {
    // Both endpoints below min -> clamp collapses to [min, min] -> null.
    expect(normalizeRange(-5, -2, { min: 0, max: 10 })).toBeNull();
    // Both endpoints above max -> collapse to [max, max] -> null.
    expect(normalizeRange(12, 20, { min: 0, max: 10 })).toBeNull();
  });

  it("preserves a sub-range that sits inside the bounds untouched", () => {
    expect(normalizeRange(4, 6, { min: 0, max: 10 })).toEqual([4, 6]);
  });
});

// The optional 2-D y-box (MATLAB `onBGMouseUp` parity — GAP #96/#20).
// `withYRange` is the only new surface: it never touches `normalizeRange`'s
// own X behaviour (every test above still exercises the untouched function).
describe("withYRange", () => {
  const x: [number, number] = [1, 4];

  it("carries a y-range alongside the x-range when both endpoints are given", () => {
    const picked: RegionPick = withYRange(x, 2, 8);
    expect(picked).toEqual({ x: [1, 4], yRange: [2, 8] });
  });

  it("normalizes an inverted y drag the same way normalizeRange orders x", () => {
    expect(withYRange(x, 8, 2)).toEqual({ x: [1, 4], yRange: [2, 8] });
  });

  it("omits yRange (undefined, not null) when y0/y1 are missing", () => {
    const picked = withYRange(x);
    expect(picked).toEqual({ x: [1, 4] });
    expect(picked.yRange).toBeUndefined();
    expect("yRange" in picked).toBe(false); // no null smuggled in either
  });

  it("omits yRange for a degenerate (zero-span) y drag", () => {
    expect(withYRange(x, 5, 5)).toEqual({ x: [1, 4] });
  });

  it("omits yRange when the y span clamps entirely outside bounds", () => {
    expect(withYRange(x, 12, 20, { min: 0, max: 10 })).toEqual({ x: [1, 4] });
  });

  it("clamps the y-range into bounds like normalizeRange clamps x", () => {
    expect(withYRange(x, -3, 6, { min: 0, max: 5 })).toEqual({ x: [1, 4], yRange: [0, 5] });
  });

  it("leaves the x window exactly as passed in, regardless of y", () => {
    // withYRange never re-derives x — it's the caller's already-normalized
    // window (e.g. from clampPlottedRange), passed straight through.
    expect(withYRange([-9, 100], 2, 3).x).toEqual([-9, 100]);
  });
});
