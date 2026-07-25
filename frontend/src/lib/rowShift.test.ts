// Row-index remapping (MAIN_PLAN #34). The point of these functions is that an
// explicit insert/delete KNOWS what moved, so row exclusions get remapped
// rather than thrown away — unlike a trim, whose before/after mapping is not
// recoverable from lengths alone.

import { describe, expect, it } from "vitest";

import { dropRows, insertBlanks, shiftForDelete, shiftForInsert } from "./rowShift";

describe("shiftForInsert", () => {
  it("moves indices at or below the insertion point down", () => {
    expect(shiftForInsert([0, 5, 9], 5, 2)).toEqual([0, 7, 11]);
  });

  it("leaves indices above the insertion point alone", () => {
    expect(shiftForInsert([0, 1, 2], 5, 3)).toEqual([0, 1, 2]);
  });

  it("treats an index AT the insertion point as moving down", () => {
    // "Insert at row 5" puts the new rows ABOVE row 5, so old row 5 moves.
    expect(shiftForInsert([5], 5, 1)).toEqual([6]);
  });

  it("is a no-op for a non-positive count", () => {
    expect(shiftForInsert([1, 2], 0, 0)).toEqual([1, 2]);
    expect(shiftForInsert([1, 2], 0, -3)).toEqual([1, 2]);
  });

  it("does not mutate its input", () => {
    const src = [1, 2];
    shiftForInsert(src, 0, 5);
    expect(src).toEqual([1, 2]);
  });
});

describe("shiftForDelete", () => {
  it("drops a deleted index entirely", () => {
    expect(shiftForDelete([1, 2, 3], new Set([2]))).toEqual([1, 2]);
  });

  it("moves a survivor up by the count of deleted rows BELOW it", () => {
    expect(shiftForDelete([5], new Set([0, 1]))).toEqual([3]);
  });

  it("ignores deleted rows above a survivor", () => {
    expect(shiftForDelete([2], new Set([7, 8]))).toEqual([2]);
  });

  it("handles interleaved deletions", () => {
    // delete 1 and 4 from 0..5 -> survivors 0,2,3,5 become 0,1,2,3
    expect(shiftForDelete([0, 2, 3, 5], new Set([1, 4]))).toEqual([0, 1, 2, 3]);
  });

  it("is a no-op for an empty deletion set", () => {
    expect(shiftForDelete([3, 4], new Set())).toEqual([3, 4]);
  });

  it("returns empty when everything referenced was deleted", () => {
    expect(shiftForDelete([1, 2], new Set([1, 2]))).toEqual([]);
  });
});

describe("insertBlanks", () => {
  it("splices blanks in at the position", () => {
    const out = insertBlanks([1, 2, 3], 1, 2);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(1);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(2);
  });

  it("appends when the position is past the end", () => {
    expect(insertBlanks([1], 99, 1)).toHaveLength(2);
  });

  it("clamps a negative position to the start", () => {
    const out = insertBlanks([1, 2], -5, 1);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBe(1);
  });
});

describe("dropRows", () => {
  it("removes the named positions", () => {
    expect(dropRows([10, 20, 30, 40], new Set([1, 3]))).toEqual([10, 30]);
  });

  it("is a no-op for an empty set", () => {
    expect(dropRows([1, 2], new Set())).toEqual([1, 2]);
  });
});
