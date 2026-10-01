// P2.8 residual (b): half-open limit pairs — the shared parse/resolve/restore
// rules behind the plot's X/Y limits and the map's colour limits.

import { describe, expect, it } from "vitest";

import { resolveHalfLim, sanitizeHalfLim } from "./axisLim";
import { limOr, parseLimFields } from "./axisLimFields";

describe("parseLimFields", () => {
  it("a blank side is auto for that side, never 0", () => {
    expect(parseLimFields("", "5")).toEqual([null, 5]);
    expect(parseLimFields("2", " ")).toEqual([2, null]);
    expect(parseLimFields("", "")).toBeNull();
    expect(parseLimFields("1", "4")).toEqual([1, 4]);
  });

  it("a non-numeric side or a typed inverted pair is not a valid entry", () => {
    expect(parseLimFields("abc", "4")).toBeUndefined();
    expect(parseLimFields("4", "4")).toBeUndefined();
    expect(parseLimFields("9", "4")).toBeUndefined();
  });
});

describe("resolveHalfLim", () => {
  it("fills the blank side from the auto extent; a full pair passes through by reference", () => {
    expect(resolveHalfLim([null, 5], [0, 10])).toEqual({ range: [0, 5], crossed: false });
    const full: [number, number] = [9, 1]; // a deliberately reversed (Origin) axis
    expect(resolveHalfLim(full, [0, 10]).range).toBe(full);
  });

  it("a typed side on or past the auto side falls back to full auto and reports it", () => {
    expect(resolveHalfLim([10, null], [0, 10])).toEqual({ range: null, crossed: true });
    expect(resolveHalfLim([null, -1], [0, 10])).toEqual({ range: null, crossed: true });
    expect(resolveHalfLim([2, null], null)).toEqual({ range: null, crossed: false });
  });

  it("limOr falls back per side, and to the extent when crossed", () => {
    expect(limOr([null, 5], [0, 10])).toEqual([0, 5]);
    expect(limOr([20, null], [0, 10])).toEqual([0, 10]);
    expect(limOr(null, [0, 10])).toEqual([0, 10]);
  });
});

describe("sanitizeHalfLim", () => {
  it("keeps a fixed or half-open pair and drops anything else to auto", () => {
    expect(sanitizeHalfLim([1, 2])).toEqual([1, 2]);
    expect(sanitizeHalfLim([null, 2])).toEqual([null, 2]);
    expect(sanitizeHalfLim([null, null])).toBeNull();
    expect(sanitizeHalfLim([1, "2"])).toBeNull();
    expect(sanitizeHalfLim([1])).toBeNull();
    expect(sanitizeHalfLim("1,2")).toBeNull();
  });
});
