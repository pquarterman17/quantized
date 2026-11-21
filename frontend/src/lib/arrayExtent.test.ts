import { describe, expect, it } from "vitest";

import { maxOf, minOf } from "./arrayExtent";
import { pushAll } from "./pushAll";

const BIG = 300_000;

describe("arrayExtent", () => {
  it("min/max over a 300k array where the spread form overflows", () => {
    const a = Array.from({ length: BIG }, (_, i) => i - 5);
    expect(() => Math.min(...a)).toThrow(RangeError);
    expect(minOf(a)).toBe(-5);
    expect(maxOf(a)).toBe(BIG - 6);
    expect(maxOf(new Float64Array(a))).toBe(BIG - 6);
  });
  it("matches Math.min/max on empty and NaN input", () => {
    expect(minOf([])).toBe(Infinity);
    expect(maxOf([])).toBe(-Infinity);
    expect(minOf([1, NaN, 0])).toBeNaN();
    expect(maxOf([1, NaN, 0])).toBeNaN();
  });
  it("pushAll appends a 300k array", () => {
    const more = Array.from({ length: BIG }, (_, i) => i);
    const t = [-1];
    expect(() => t.push(...more)).toThrow(RangeError);
    const u = [-1];
    expect(pushAll(u, more)).toBe(BIG + 1);
    expect(u[0]).toBe(-1);
    expect(u[BIG]).toBe(BIG - 1);
  });
});
