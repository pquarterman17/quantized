import { describe, expect, it } from "vitest";

import { trapz } from "./integrate";

describe("trapz", () => {
  it("integrates a constant exactly (area = height × width)", () => {
    const x = [0, 1, 2, 3, 4];
    const y = [2, 2, 2, 2, 2];
    expect(trapz(x, y, 0, 4)).toBeCloseTo(8, 12);
  });

  it("integrates a line y=x over [0,4] = 8", () => {
    const x = [0, 1, 2, 3, 4];
    const y = [0, 1, 2, 3, 4];
    expect(trapz(x, y, 0, 4)).toBeCloseTo(8, 12);
  });

  it("interpolates the end segments at fractional boundaries", () => {
    // y = x over [0.5, 2.5] → ∫ = (2.5² − 0.5²)/2 = 3
    const x = [0, 1, 2, 3];
    const y = [0, 1, 2, 3];
    expect(trapz(x, y, 0.5, 2.5)).toBeCloseTo(3, 12);
  });

  it("normalises reversed bounds", () => {
    const x = [0, 1, 2];
    const y = [1, 1, 1];
    expect(trapz(x, y, 2, 0)).toBeCloseTo(2, 12);
  });

  it("is signed (negative y subtracts)", () => {
    const x = [0, 1, 2];
    const y = [-3, -3, -3];
    expect(trapz(x, y, 0, 2)).toBeCloseTo(-6, 12);
  });

  it("skips segments with null/non-finite endpoints", () => {
    const x = [0, 1, 2, 3];
    const y = [1, null, 1, 1];
    // segments [0,1] and [1,2] drop (null at i=1); only [2,3] counts = 1
    expect(trapz(x, y, 0, 3)).toBeCloseTo(1, 12);
  });

  it("returns 0 when the range misses the data", () => {
    expect(trapz([0, 1, 2], [5, 5, 5], 10, 20)).toBe(0);
  });
});
