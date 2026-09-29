import { describe, expect, it } from "vitest";

import {
  clearEdits,
  fillDownEdits,
  gridToClipboardText,
  parseCell,
  parseClipboardGrid,
  pasteEdits,
  pasteTargetRows,
} from "./clipboardGrid";

const bounds = { rows: 5, writableCols: 3 };

describe("parseClipboardGrid", () => {
  it("splits tab-separated columns and newline rows", () => {
    expect(parseClipboardGrid("1\t2\n3\t4")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles CRLF, which is what Windows spreadsheets emit", () => {
    expect(parseClipboardGrid("1\t2\r\n3\t4")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("ignores the trailing newline Excel always appends", () => {
    // Treating it as a real row would blank a row of the destination.
    expect(parseClipboardGrid("1\t2\n")).toEqual([["1", "2"]]);
    expect(parseClipboardGrid("1\t2\r\n")).toEqual([["1", "2"]]);
  });

  it("returns nothing for empty input", () => {
    expect(parseClipboardGrid("")).toEqual([]);
    expect(parseClipboardGrid("\n")).toEqual([]);
  });

  it("keeps ragged rows ragged rather than padding them", () => {
    expect(parseClipboardGrid("1\t2\t3\n4")).toEqual([["1", "2", "3"], ["4"]]);
  });
});

describe("parseCell", () => {
  it("parses plain numbers", () => {
    expect(parseCell("42")).toBe(42);
    expect(parseCell(" -3.5 ")).toBe(-3.5);
    expect(parseCell("1e3")).toBe(1000);
  });

  it("strips valid thousands separators from formatted spreadsheet columns", () => {
    expect(parseCell("1,234.5")).toBe(1234.5);
    expect(parseCell("1,500")).toBe(1500);
    expect(parseCell("-12,345,678")).toBe(-12345678);
  });

  it("maps a blank cell to NaN, the missing marker (a paste can clear)", () => {
    expect(parseCell("")).toBeNaN();
    expect(parseCell("   ")).toBeNaN();
  });

  it("refuses text rather than blanking the cell with NaN", () => {
    expect(parseCell("n/a")).toBeNull();
    expect(parseCell("control")).toBeNull();
  });

  it("refuses a comma that is not a thousands group ('1,5' is 1.5 or 15)", () => {
    expect(parseCell("1,5")).toBeNull();
    expect(parseCell("1,5000")).toBeNull();
    expect(parseCell("1.234,5")).toBeNull();
  });
});

describe("pasteEdits", () => {
  it("writes a block at the anchor", () => {
    const { edits } = pasteEdits([["1", "2"]], [0], 0, bounds);
    expect(edits).toEqual([
      { row: 0, col: 0, value: 1 },
      { row: 0, col: 1, value: 2 },
    ]);
  });

  it("can anchor on the x column (-1)", () => {
    const { edits } = pasteEdits([["7", "8"]], [2], -1, bounds);
    expect(edits).toEqual([
      { row: 2, col: -1, value: 7 },
      { row: 2, col: 0, value: 8 },
    ]);
  });

  it("CLIPS past the last row instead of growing the dataset", () => {
    // Growing would invalidate every row-indexed piece of state at once
    // (exclusions, filters, fit overlays), so a paste never changes dimensions.
    const grid = [["1"], ["2"], ["3"]];
    const { edits, clippedCells } = pasteEdits(grid, [3, 4, 5], 0, bounds); // row 5 is past the end
    expect(edits.map((e) => e.row)).toEqual([3, 4]);
    expect(clippedCells).toBe(1);
  });

  it("reports cells that land on read-only / out-of-range columns", () => {
    const { edits, readOnlyCells } = pasteEdits([["1", "2", "3", "4"]], [0], 1, bounds);
    expect(edits.map((e) => e.col)).toEqual([1, 2]);
    expect(readOnlyCells).toBe(2); // cols 3 and 4 are not writable
  });

  it("counts clipping and read-only refusals separately", () => {
    // They are different messages: "wider than the sheet" vs "that's a formula".
    const { clippedCells, readOnlyCells } = pasteEdits([["1", "2"]], [99], 0, bounds);
    expect(clippedCells).toBe(2);
    expect(readOnlyCells).toBe(0);
  });

  it("carries blank source cells through as NaN", () => {
    const { edits } = pasteEdits([["", "5"]], [1], 0, bounds);
    expect(edits[0].value).toBeNaN();
    expect(edits[1].value).toBe(5);
  });

  it("handles ragged rows without misaligning later ones", () => {
    const { edits } = pasteEdits([["1", "2"], ["3"]], [0, 1], 0, bounds);
    expect(edits).toEqual([
      { row: 0, col: 0, value: 1 },
      { row: 0, col: 1, value: 2 },
      { row: 1, col: 0, value: 3 },
    ]);
  });

  it("produces nothing for an empty grid", () => {
    expect(pasteEdits([], [0], 0, bounds).edits).toEqual([]);
  });

  it("follows the VISIBLE row order of a sorted sheet, not the original order", () => {
    // y=[50,10,40,20,30] sorted ascending shows rows [1,3,4,2,0]. Pasting 3
    // values over the top 3 visible rows must land on 1,3,4 — not 1,2,3.
    const order = [1, 3, 4, 2, 0];
    const { edits } = pasteEdits([["5"], ["6"], ["7"]], pasteTargetRows(order, 1), 0, bounds);
    expect(edits.map((e) => [e.row, e.value])).toEqual([[1, 5], [3, 6], [4, 7]]);
  });

  it("never writes into rows a filter hides — the overflow is clipped", () => {
    const visible = [0, 2, 4]; // rows 1 and 3 filtered out
    const { edits, clippedCells } = pasteEdits([["5"], ["6"], ["7"]], pasteTargetRows(visible, 2), 0, bounds);
    expect(edits.map((e) => e.row)).toEqual([2, 4]);
    expect(clippedCells).toBe(1);
  });

  it("skips non-numeric text in a numeric column and counts it", () => {
    const { edits, skippedCells } = pasteEdits([["control", "1,5", "2"]], [0], 0, bounds);
    expect(edits).toEqual([{ row: 0, col: 2, value: 2 }]);
    expect(skippedCells).toBe(2);
  });

  it("maps labels to level codes in a categorical column (case-insensitive)", () => {
    const levelsAt = (col: number) => (col === 0 ? ["control", "treated"] : null);
    const { edits, skippedCells, newLevels } = pasteEdits(
      [["Treated"], ["control"], [""]],
      [0, 1, 2],
      0,
      { ...bounds, levelsAt },
    );
    expect(edits.map((e) => e.value)).toEqual([1, 0, Number.NaN]);
    expect(skippedCells).toBe(0);
    expect(newLevels).toEqual({});
  });

  it("extends the level table for an unknown label, once per distinct label", () => {
    // Same as setCategoricalCell: a typed label is picked or added, never dropped.
    const levelsAt = (col: number) => (col === 0 ? ["control", "treated"] : null);
    const { edits, newLevels } = pasteEdits(
      [["sham"], ["SHAM"], ["dose"]],
      [0, 1, 2],
      0,
      { ...bounds, levelsAt },
    );
    expect(edits.map((e) => e.value)).toEqual([2, 2, 3]);
    expect(newLevels).toEqual({ 0: ["sham", "dose"] });
  });

  it("keeps a numeric code in a categorical column (the pre-coded paste path)", () => {
    const levelsAt = (col: number) => (col === 0 ? ["control", "treated"] : null);
    const { edits, newLevels } = pasteEdits([["1"]], [0], 0, { ...bounds, levelsAt });
    expect(edits).toEqual([{ row: 0, col: 0, value: 1 }]);
    expect(newLevels).toEqual({});
  });
});

describe("pasteTargetRows", () => {
  it("starts at the anchor's position in the view order", () => {
    expect(pasteTargetRows([1, 3, 4, 2, 0], 4)).toEqual([4, 2, 0]);
  });

  it("is empty when the anchor is not visible", () => {
    expect(pasteTargetRows([0, 2], 1)).toEqual([]);
  });
});

describe("gridToClipboardText", () => {
  it("round-trips through parseClipboardGrid", () => {
    const text = gridToClipboardText([
      [1, 2],
      [3, 4],
    ]);
    expect(text).toBe("1\t2\n3\t4");
    expect(parseClipboardGrid(text)).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("writes null and NaN as empty fields so the width stays constant", () => {
    expect(gridToClipboardText([[1, null], [Number.NaN, 4]])).toBe("1\t\n\t4");
  });
});

describe("clearEdits", () => {
  it("blanks every selected writable cell", () => {
    const edits = clearEdits([0, 1], [0, 1], bounds);
    expect(edits).toHaveLength(4);
    expect(edits.every((e) => Number.isNaN(e.value))).toBe(true);
  });

  it("skips read-only and out-of-range coordinates", () => {
    expect(clearEdits([0, 99], [0, 3], bounds)).toEqual([{ row: 0, col: 0, value: Number.NaN }]);
  });
});

describe("fillDownEdits", () => {
  const valueAt = (row: number, col: number) => (row === 0 ? 10 * (col + 1) : 0);

  it("copies the first selected row down the rest", () => {
    const edits = fillDownEdits([0, 1, 2], [0], bounds, valueAt);
    expect(edits).toEqual([
      { row: 1, col: 0, value: 10 },
      { row: 2, col: 0, value: 10 },
    ]);
  });

  it("uses the FIRST row in the given (view) order as the source", () => {
    // A sorted sheet shows row 2 on top: fill-down copies row 2's value down.
    const byRow = (row: number) => row * 100;
    const edits = fillDownEdits([2, 0, 1], [0], bounds, byRow);
    expect(edits).toEqual([
      { row: 0, col: 0, value: 200 },
      { row: 1, col: 0, value: 200 },
    ]);
  });

  it("does nothing with fewer than two rows", () => {
    expect(fillDownEdits([0], [0], bounds, valueAt)).toEqual([]);
    expect(fillDownEdits([], [0], bounds, valueAt)).toEqual([]);
  });

  it("skips a column whose source cell is missing", () => {
    expect(fillDownEdits([0, 1], [0], bounds, () => null)).toEqual([]);
  });

  it("skips read-only columns", () => {
    expect(fillDownEdits([0, 1], [3], bounds, valueAt)).toEqual([]);
  });
});
