// BUG-021 defect 2: a NaN cell becomes `null` in the request body and pydantic
// `list[float]` rejects it, one validation error per gap. These pin the chosen
// contract — drop the gap rows, put them back at the SAME row indices — and in
// particular that the round trip can never misalign.

import { describe, expect, it } from "vitest";

import {
  dropGapRows,
  restoreGapRows,
  restoreSubstituted,
  substituteGaps,
} from "./finitePairs";

describe("dropGapRows", () => {
  it("drops a row when EITHER coordinate is non-finite and records its origin", () => {
    const x = [0, 1, Number.NaN, 3, 4];
    const y = [10, Number.NaN, 30, 40, Number.POSITIVE_INFINITY];
    const pairs = dropGapRows(x, y);
    expect(pairs.x).toEqual([0, 3]);
    expect(pairs.y).toEqual([10, 40]);
    expect(pairs.keep).toEqual([0, 3]);
    expect(pairs.n).toBe(5);
    expect(pairs.complete).toBe(false);
  });

  it("marks a gap-free series complete and keeps every row", () => {
    const pairs = dropGapRows([1, 2, 3], [4, 5, 6]);
    expect(pairs.keep).toEqual([0, 1, 2]);
    expect(pairs.complete).toBe(true);
  });

  it("never serializes a gap as null — the actual 422 trigger", () => {
    const pairs = dropGapRows([0, 1, 2], [1, Number.NaN, 3]);
    expect(JSON.stringify(pairs.y)).not.toContain("null");
    // ... whereas the raw series does, which is what reached the backend.
    expect(JSON.stringify([1, Number.NaN, 3])).toBe("[1,null,3]");
  });

  it("treats a short y as gaps rather than zero-filling", () => {
    const pairs = dropGapRows([0, 1, 2], [5]);
    expect(pairs.keep).toEqual([0]);
    expect(pairs.n).toBe(3);
  });
});

describe("restoreGapRows", () => {
  it("puts the backend's values back on their ORIGINAL rows, gaps still gaps", () => {
    const x = [0, 1, Number.NaN, 3, 4];
    const y = [10, Number.NaN, 30, 40, 50];
    const pairs = dropGapRows(x, y);
    expect(pairs.keep).toEqual([0, 3, 4]);
    const out = restoreGapRows([100, 400, 500], pairs);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(100);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(400);
    expect(out[4]).toBe(500);
  });

  it("decodes the backend's null (its own non-finite encoding) back to NaN", () => {
    const pairs = dropGapRows([0, 1], [0, 1]);
    const out = restoreGapRows([1, null], pairs);
    expect(out[0]).toBe(1);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  it("round-trips a gap-free series unchanged", () => {
    const pairs = dropGapRows([0, 1, 2], [3, 4, 5]);
    expect(restoreGapRows([3, 4, 5], pairs)).toEqual([3, 4, 5]);
  });

  it("THROWS on a length mismatch rather than shifting every later row", () => {
    const pairs = dropGapRows([0, 1, Number.NaN], [0, 1, 2]);
    expect(() => restoreGapRows([1, 2, 3], pairs)).toThrow(/cannot align/);
    expect(() => restoreGapRows([1], pairs)).toThrow(/cannot align/);
  });
});

// The ELEMENTWISE pair. `dropGapRows` couples the two coordinates, which is
// right for a fit and wrong for a per-row transform: it would discard a good
// field value over a gap in the moment.
describe("substituteGaps / restoreSubstituted", () => {
  it("replaces every non-finite entry with a finite placeholder and records which were real", () => {
    const s = substituteGaps([1, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(s.safe).toEqual([1, 0, 3, 0]);
    expect(s.finite).toEqual([true, false, true, false]);
    expect(JSON.stringify(s.safe)).not.toContain("null");
  });

  it("keeps the transformed value where the input was real and re-gaps the rest", () => {
    const s = substituteGaps([1, Number.NaN, 3]);
    expect(restoreSubstituted([10, 0, 30], s.finite)).toEqual([10, Number.NaN, 30]);
  });

  it("each axis keeps exactly its OWN gaps — the two are never coupled", () => {
    const xs = substituteGaps([0, 100, 200]); // no gaps
    const ys = substituteGaps([5, Number.NaN, 1]); // one gap
    expect(restoreSubstituted([0, 0.01, 0.02], xs.finite)).toEqual([0, 0.01, 0.02]);
    const y = restoreSubstituted([5, 0, 1], ys.finite);
    expect(y[0]).toBe(5);
    expect(Number.isNaN(y[1])).toBe(true);
    expect(y[2]).toBe(1);
  });

  it("decodes the backend's null to NaN and preserves the full length", () => {
    const s = substituteGaps([1, 2]);
    expect(restoreSubstituted([1, null], s.finite)).toEqual([1, Number.NaN]);
  });

  it("THROWS on a length mismatch, like its fit-path sibling", () => {
    const s = substituteGaps([1, 2, 3]);
    expect(() => restoreSubstituted([1, 2], s.finite)).toThrow(/cannot align/);
  });
});
