// Worksheet column visibility (lib/worksheetColumnView.ts): the hidden/frozen
// splits, how both follow a column insert / delete / move, the .dwk loader's
// validation, and the keyboard cursor stepping over hidden columns.

import { describe, expect, it } from "vitest";

import { remapDatasetChannels } from "./channelRemap";
import { cellAt, clampCell, jumpCursor, moveCursor, rangeCols } from "./gridCursor";
import { hiddenRuns, shownColumns, splitColumns } from "./worksheetColumnView";
import { sanitizeFrozenCols, sanitizeHiddenCols } from "./worksheetColumnViewSanitize";

describe("splits", () => {
  it("shown columns skip the hidden ones; the frozen prefix is by index", () => {
    const hidden = new Set([1, 4]);
    expect(shownColumns(6, hidden)).toEqual([0, 2, 3, 5]);
    expect(splitColumns(6, hidden, 3)).toEqual({ frozenCols: [0, 2], scrollCols: [3, 5] });
    expect(splitColumns(6, new Set(), 0)).toEqual({ frozenCols: [], scrollCols: [0, 1, 2, 3, 4, 5] });
    expect(splitColumns(3, new Set(), 99).scrollCols).toEqual([]); // clamped to the column count
  });

  it("a hidden run is keyed by the shown column before it (-1 = X)", () => {
    const runs = hiddenRuns(7, new Set([0, 1, 4, 6]));
    expect([...runs.entries()]).toEqual([
      [-1, [0, 1]],
      [3, [4]],
      [5, [6]],
    ]);
  });
});

describe("column insert / delete / move remap both fields", () => {
  const state = { hiddenCols: [1, 4], frozenCols: 3 };

  it("an insert shifts hidden columns up and widens the prefix only when it lands inside it", () => {
    expect(remapDatasetChannels(state, { inserted: 0 })).toMatchObject({ hiddenCols: [2, 5], frozenCols: 4 });
    expect(remapDatasetChannels(state, { inserted: 3 })).toMatchObject({ hiddenCols: [1, 5], frozenCols: 3 }); // at the boundary: outside
    expect(remapDatasetChannels(state, { inserted: 9 })).toMatchObject({ hiddenCols: [1, 4], frozenCols: 3 });
  });

  it("a delete drops a hidden column that is gone and narrows the prefix", () => {
    expect(remapDatasetChannels(state, 1)).toMatchObject({ hiddenCols: [3], frozenCols: 2 });
    expect(remapDatasetChannels(state, 4)).toMatchObject({ hiddenCols: [1], frozenCols: 3 });
    expect(remapDatasetChannels({ hiddenCols: [2] }, 2).hiddenCols).toBeUndefined(); // absent, never []
    expect(remapDatasetChannels({ frozenCols: 1 }, 0).frozenCols).toBeUndefined();
  });

  it("a move carries a hidden column with it and re-counts the prefix", () => {
    expect(remapDatasetChannels(state, { from: 1, to: 5 }).hiddenCols).toEqual([3, 5]);
    expect(remapDatasetChannels(state, { from: 1, to: 5 }).frozenCols).toBe(2); // left the prefix
    expect(remapDatasetChannels(state, { from: 5, to: 0 }).frozenCols).toBe(4); // entered it
    expect(remapDatasetChannels(state, { from: 0, to: 2 }).frozenCols).toBe(3); // within it
  });
});

describe(".dwk validation", () => {
  it("keeps only unique in-range integer columns, ascending", () => {
    expect(sanitizeHiddenCols([3, 1, 1, -1, 9, 2.5, "x", 2], 5)).toEqual([1, 2, 3]);
    expect(sanitizeHiddenCols([9], 5)).toBeUndefined();
    expect(sanitizeHiddenCols("1,2", 5)).toBeUndefined();
  });

  it("the frozen count must be a positive integer, clamped to the column count", () => {
    expect(sanitizeFrozenCols(3, 5)).toBe(3);
    expect(sanitizeFrozenCols(40, 5)).toBe(5);
    expect(sanitizeFrozenCols(0, 5)).toBeUndefined();
    expect(sanitizeFrozenCols(-2, 5)).toBeUndefined();
    expect(sanitizeFrozenCols(1.5, 5)).toBeUndefined();
    expect(sanitizeFrozenCols("2", 5)).toBeUndefined();
  });
});

describe("keyboard cursor skips hidden columns", () => {
  const b = { rows: 10, cols: 6, hidden: new Set([1, 2, 5]) };

  it("arrow right/left step over hidden columns, and stop at the last shown one", () => {
    const at0 = cellAt({ pos: 0, col: 0 }, b);
    expect(moveCursor(at0, 0, 1, false, b).focus.col).toBe(3);
    expect(moveCursor(cellAt({ pos: 0, col: 3 }, b), 0, -1, false, b).focus.col).toBe(0);
    expect(moveCursor(cellAt({ pos: 0, col: 4 }, b), 0, 1, false, b).focus.col).toBe(4); // 5 is hidden, nothing beyond
    expect(moveCursor(cellAt({ pos: 0, col: 0 }, b), 0, -1, false, b).focus.col).toBe(-1); // onto X
    expect(moveCursor(cellAt({ pos: 0, col: -1 }, b), 0, 1, false, b).focus.col).toBe(0);
  });

  it("Ctrl+Right lands on the last SHOWN column and a clamped cell is never on a hidden one", () => {
    expect(jumpCursor(cellAt({ pos: 0, col: 0 }, b), "right", false, b).focus.col).toBe(4);
    expect(clampCell({ pos: 0, col: 1 }, b).col).toBe(0);
    expect(clampCell({ pos: 0, col: 5 }, b).col).toBe(4);
  });

  it("a range's columns leave out hidden ones, so copy / fill / clear never touch them", () => {
    const r = { anchor: { pos: 0, col: 0 }, focus: { pos: 2, col: 4 } };
    expect(rangeCols(r, b.hidden)).toEqual([0, 3, 4]);
    expect(rangeCols(r)).toEqual([0, 1, 2, 3, 4]);
  });
});
