// The worksheet cell cursor's geometry (worksheet audit #5: there was no
// cell cursor, no arrow/Tab/Enter navigation and no cell range at all).

import { describe, expect, it } from "vitest";

import { remapChannel } from "./channelRemap";
import { shiftLetter } from "./formulaRename";
import {
  cellAt,
  inRange,
  jumpCursor,
  moveCursor,
  rangeCols,
  rangeRows,
  startsTyping,
} from "./gridCursor";

const b = { rows: 5, cols: 3 };

describe("cell cursor", () => {
  it("moves, clamps at the edges (X is column -1) and extends with Shift", () => {
    const r = cellAt({ pos: 0, col: -1 }, b);
    expect(moveCursor(r, -1, -1, false, b).focus).toEqual({ pos: 0, col: -1 });
    const ext = moveCursor(moveCursor(r, 2, 0, true, b), 0, 2, true, b);
    expect(ext).toEqual({ anchor: { pos: 0, col: -1 }, focus: { pos: 2, col: 1 } });
    expect(rangeCols(ext)).toEqual([-1, 0, 1]);
    expect(rangeRows(ext, [4, 3, 2, 1, 0])).toEqual([4, 3, 2]);
    expect(inRange(ext, 1, 0)).toBe(true);
    expect(inRange(ext, 3, 0)).toBe(false);
    expect(moveCursor(ext, 1, 0, false, b)).toEqual({ anchor: { pos: 3, col: 1 }, focus: { pos: 3, col: 1 } });
  });

  it("jumps to an edge (Ctrl+arrow / Home / End)", () => {
    const r = cellAt({ pos: 2, col: 1 }, b);
    expect(jumpCursor(r, "bottom", false, b).focus).toEqual({ pos: 4, col: 1 });
    expect(jumpCursor(r, "left", true, b)).toEqual({ anchor: { pos: 2, col: 1 }, focus: { pos: 2, col: -1 } });
  });

  it("the entry row (past the last data row) has no original row yet", () => {
    expect(rangeRows({ anchor: { pos: 1, col: 0 }, focus: { pos: 3, col: 0 } }, [0, 1, 2])).toEqual([1, 2]);
  });

  it("a printable key starts editing; shortcuts and named keys do not", () => {
    const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
      startsTyping({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    expect(k("7")).toBe(true);
    expect(k("-")).toBe(true);
    expect(k("E")).toBe(true);
    expect(k("c", { ctrlKey: true })).toBe(false);
    expect(k("Enter")).toBe(false);
    expect(k("F2")).toBe(false);
  });
});

// [column, from, to, expected]: the moved column, the ones it passes, and the rest.
const moveCases: [number, number, number, number][] = [
  [0, 0, 2, 2], [1, 0, 2, 0], [2, 0, 2, 1], [3, 0, 2, 3],
  [2, 2, 0, 0], [0, 2, 0, 1], [1, 2, 0, 2], [-1, 2, 0, -1],
];

describe("Move Column index shift", () => {
  it.each(moveCases)("remapChannel(%i, move %i→%i) = %i", (c, from, to, want) => {
    expect(remapChannel(c, { from, to })).toBe(want);
  });

  it("formula letters follow a moved column", () => {
    expect(shiftLetter("A", { from: 0, to: 2 })).toEqual({ letter: "C", removed: false });
    expect(shiftLetter("C", { from: 0, to: 2 })).toEqual({ letter: "B", removed: false });
    expect(shiftLetter("D", { from: 0, to: 2 })).toEqual({ letter: "D", removed: false });
  });
});
