import { describe, expect, it } from "vitest";

import {
  clearEdits,
  fillDownEdits,
  gridToClipboardText,
  parseCell,
  parseClipboardGrid,
  pasteEdits,
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

  it("strips thousands separators from formatted spreadsheet columns", () => {
    expect(parseCell("1,234.5")).toBe(1234.5);
  });

  it("maps blank and unparseable text to NaN, the missing marker", () => {
    expect(parseCell("")).toBeNaN();
    expect(parseCell("   ")).toBeNaN();
    expect(parseCell("n/a")).toBeNaN();
  });
});

describe("pasteEdits", () => {
  it("writes a block at the anchor", () => {
    const { edits } = pasteEdits([["1", "2"]], 0, 0, bounds);
    expect(edits).toEqual([
      { row: 0, col: 0, value: 1 },
      { row: 0, col: 1, value: 2 },
    ]);
  });

  it("can anchor on the x column (-1)", () => {
    const { edits } = pasteEdits([["7", "8"]], 2, -1, bounds);
    expect(edits).toEqual([
      { row: 2, col: -1, value: 7 },
      { row: 2, col: 0, value: 8 },
    ]);
  });

  it("CLIPS past the last row instead of growing the dataset", () => {
    // Growing would invalidate every row-indexed piece of state at once
    // (exclusions, filters, fit overlays), so a paste never changes dimensions.
    const grid = [["1"], ["2"], ["3"]];
    const { edits, clippedCells } = pasteEdits(grid, 3, 0, bounds); // rows 3,4,5
    expect(edits.map((e) => e.row)).toEqual([3, 4]);
    expect(clippedCells).toBe(1);
  });

  it("reports cells that land on read-only / out-of-range columns", () => {
    const { edits, readOnlyCells } = pasteEdits([["1", "2", "3", "4"]], 0, 1, bounds);
    expect(edits.map((e) => e.col)).toEqual([1, 2]);
    expect(readOnlyCells).toBe(2); // cols 3 and 4 are not writable
  });

  it("counts clipping and read-only refusals separately", () => {
    // They are different messages: "wider than the sheet" vs "that's a formula".
    const { clippedCells, readOnlyCells } = pasteEdits([["1", "2"]], 99, 0, bounds);
    expect(clippedCells).toBe(2);
    expect(readOnlyCells).toBe(0);
  });

  it("carries blank source cells through as NaN", () => {
    const { edits } = pasteEdits([["", "5"]], 1, 0, bounds);
    expect(edits[0].value).toBeNaN();
    expect(edits[1].value).toBe(5);
  });

  it("handles ragged rows without misaligning later ones", () => {
    const { edits } = pasteEdits([["1", "2"], ["3"]], 0, 0, bounds);
    expect(edits).toEqual([
      { row: 0, col: 0, value: 1 },
      { row: 0, col: 1, value: 2 },
      { row: 1, col: 0, value: 3 },
    ]);
  });

  it("produces nothing for an empty grid", () => {
    expect(pasteEdits([], 0, 0, bounds).edits).toEqual([]);
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

  it("uses the LOWEST row as the source regardless of selection order", () => {
    const edits = fillDownEdits([2, 0, 1], [0], bounds, valueAt);
    expect(edits.map((e) => e.row)).toEqual([1, 2]);
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
