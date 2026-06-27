import { describe, expect, it } from "vitest";

import { normalizeRange } from "./regionSelect";

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
