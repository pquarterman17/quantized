import { describe, expect, it } from "vitest";

import { binRange, pctPosition, rowsInBins, rowsInRange } from "./distribution";

const EDGES = [0, 10, 20, 30, 40]; // 4 bins

describe("binRange", () => {
  it("returns the value span of a single bin", () => {
    expect(binRange(EDGES, 0)).toEqual({ lo: 0, hi: 10, inclusiveHi: false });
    expect(binRange(EDGES, 1)).toEqual({ lo: 10, hi: 20, inclusiveHi: false });
  });

  it("the LAST bin is inclusive on the high end (matches numpy.histogram)", () => {
    expect(binRange(EDGES, 3)).toEqual({ lo: 30, hi: 40, inclusiveHi: true });
  });

  it("spans a range of bins, order-independent", () => {
    expect(binRange(EDGES, 0, 2)).toEqual({ lo: 0, hi: 30, inclusiveHi: false });
    expect(binRange(EDGES, 2, 0)).toEqual({ lo: 0, hi: 30, inclusiveHi: false });
  });

  it("a range including the last bin is inclusive on the high end", () => {
    expect(binRange(EDGES, 1, 3)).toEqual({ lo: 10, hi: 40, inclusiveHi: true });
  });
});

describe("rowsInRange", () => {
  it("keeps only in-range, finite values", () => {
    const values = [5, 15, 25, 35, NaN, 10, 40];
    // bin 0: [0,10)
    expect(rowsInRange(values, { lo: 0, hi: 10, inclusiveHi: false })).toEqual([0]);
    // last bin: [30,40] inclusive
    expect(rowsInRange(values, { lo: 30, hi: 40, inclusiveHi: true })).toEqual([3, 6]);
  });

  it("a half-open bin excludes its own right edge", () => {
    const values = [10, 9.999];
    expect(rowsInRange(values, { lo: 0, hi: 10, inclusiveHi: false })).toEqual([1]);
  });

  it("drops non-finite values unconditionally", () => {
    expect(rowsInRange([NaN, Infinity, -Infinity, 5], { lo: 0, hi: 10, inclusiveHi: true })).toEqual([3]);
  });
});

describe("rowsInBins", () => {
  it("combines binRange + rowsInRange for a single bin", () => {
    const values = [5, 15, 25, 35];
    expect(rowsInBins(EDGES, values, 1)).toEqual([1]);
  });

  it("combines for a drag-spanned range of bins", () => {
    const values = [5, 15, 25, 35];
    expect(rowsInBins(EDGES, values, 0, 1)).toEqual([0, 1]);
  });

  it("maps back exactly the pruned-row indices, preserving position for a mixed finite/non-finite column", () => {
    // Mirrors analysisData's pruned (not finite-filtered) column values —
    // non-finite entries keep their pruned-index slot but never match.
    const prunedColVals = [5, NaN, 25, 35, 8];
    expect(rowsInBins(EDGES, prunedColVals, 0)).toEqual([0, 4]); // both land in [0,10)
  });
});

describe("pctPosition", () => {
  it("maps the domain endpoints to 0 and 100", () => {
    expect(pctPosition(0, 0, 10)).toBe(0);
    expect(pctPosition(10, 0, 10)).toBe(100);
    expect(pctPosition(5, 0, 10)).toBe(50);
  });

  it("clamps outside the domain", () => {
    expect(pctPosition(-5, 0, 10)).toBe(0);
    expect(pctPosition(15, 0, 10)).toBe(100);
  });

  it("degenerates to 0 for a zero-width or non-finite domain/value", () => {
    expect(pctPosition(5, 10, 10)).toBe(0);
    expect(pctPosition(NaN, 0, 10)).toBe(0);
  });
});
