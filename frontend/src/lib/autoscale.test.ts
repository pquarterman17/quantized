import { describe, expect, it } from "vitest";

import { suggestLogScale } from "./autoscale";

describe("suggestLogScale", () => {
  it("suggests log for strictly-positive multi-decade data", () => {
    expect(suggestLogScale([1, 10, 100, 1000])).toBe(true); // 3 decades
    expect(suggestLogScale([0.001, 1.2])).toBe(true);
  });

  it("stays linear for narrow-range positive data", () => {
    expect(suggestLogScale([10, 20, 30])).toBe(false); // < 2 decades
  });

  it("never suggests log when any value is ≤ 0", () => {
    expect(suggestLogScale([-5, 1, 1000])).toBe(false); // magnetometry field
    expect(suggestLogScale([0, 100, 10000])).toBe(false);
  });

  it("ignores nulls / non-finite and handles empties", () => {
    expect(suggestLogScale([null, 1, NaN, 1000, undefined])).toBe(true);
    expect(suggestLogScale([])).toBe(false);
    expect(suggestLogScale([null, null])).toBe(false);
  });
});
