import { describe, expect, it } from "vitest";

import { contiguousRowRange, rowRangeLabel, rowRangeRefusal, shiftRangeForDelete, shiftRangeForInsert } from "./rowRange";

const win = { from: 20, to: 43 }; // rows 21-44 as the user reads them

describe("rowRange remap", () => {
  it("labels 1-based source rows", () => {
    expect(rowRangeLabel(win)).toBe("rows 21-44");
    expect(rowRangeLabel({ from: 4, to: 4 })).toBe("row 5");
  });

  it("insert above moves both ends, inside grows it, after leaves it", () => {
    expect(shiftRangeForInsert(win, 5, 3)).toEqual({ from: 23, to: 46 });
    expect(shiftRangeForInsert(win, 20, 3)).toEqual({ from: 23, to: 46 }); // at the first row = inserted above it
    expect(shiftRangeForInsert(win, 30, 2)).toEqual({ from: 20, to: 45 });
    expect(shiftRangeForInsert(win, 44, 5)).toEqual(win); // appending after never extends
  });

  it("delete the first row, a middle row, rows above, and keeps the survivors contiguous", () => {
    expect(shiftRangeForDelete(win, new Set([20]))).toEqual({ from: 20, to: 42 });
    expect(shiftRangeForDelete(win, new Set([30]))).toEqual({ from: 20, to: 42 });
    expect(shiftRangeForDelete(win, new Set([0, 1, 2]))).toEqual({ from: 17, to: 40 });
    expect(shiftRangeForDelete(win, new Set([20, 21, 43]))).toEqual({ from: 20, to: 40 });
    expect(shiftRangeForDelete(win, new Set([50]))).toEqual(win);
  });

  it("deleting every row empties the range and says what it was; it never widens", () => {
    const gone = shiftRangeForDelete({ from: 2, to: 4 }, new Set([2, 3, 4]));
    expect(gone.was).toBe("rows 3-5");
    expect(rowRangeRefusal(gone, 100)).toBe("rows 3-5 no longer exist");
    expect(shiftRangeForInsert(gone, 0, 3)).toBe(gone);
    expect(shiftRangeForDelete(gone, new Set([0]))).toBe(gone);
  });

  it("refuses a range past the end or malformed, never clamping", () => {
    expect(rowRangeRefusal(win, 44)).toBeNull();
    expect(rowRangeRefusal(win, 40)).toBe("rows 21-44 is beyond the worksheet's 40 rows");
    expect(rowRangeRefusal({ from: 5, to: 2 }, 40)).toMatch(/not valid/);
    expect(rowRangeRefusal({ from: -1, to: 2 }, 40)).toMatch(/not valid/);
  });

  it("offers only a contiguous block, and names the gaps otherwise", () => {
    expect(contiguousRowRange([5, 3, 4])).toEqual({ range: { from: 3, to: 5 } });
    expect(contiguousRowRange(new Set([7]))).toEqual({ range: { from: 7, to: 7 } });
    expect(contiguousRowRange([2, 3, 4, 5, 6, 7, 8, 13])).toEqual({
      reason: "the selection has gaps (rows 3-9, 14): use Extract rows, or Exclude others",
    });
    expect(contiguousRowRange([])).toEqual({ reason: "select the rows first" });
  });
});

describe("sanitizeRowRange", () => {
  it("accepts whole, ordered, non-negative positions and refuses everything else (never clamps)", async () => {
    const { sanitizeRowRange } = await import("./rowRange");
    expect(sanitizeRowRange({ from: 20, to: 43 })).toEqual({ from: 20, to: 43 });
    expect(sanitizeRowRange({ from: 3, to: 3, extra: 1 })).toEqual({ from: 3, to: 3 });
    for (const bad of [null, undefined, 4, "x", {}, { from: -1, to: 3 }, { from: 5, to: 2 }, { from: 1.5, to: 3 }, { from: 0, to: 3, was: "rows 1-4" }]) {
      expect(sanitizeRowRange(bad)).toBeUndefined();
    }
  });
});
