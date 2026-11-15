// N4: pure find / replace over a worksheet's numeric cells.

import { describe, expect, it } from "vitest";

import { findCells, replaceCells } from "./worksheetFind";
import type { DataStruct } from "./types";

const data = (time: number[], values: number[][]): DataStruct => ({
  time,
  values,
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
});
const D = data([1, 2, 3, 4], [[1.5, 10], [2.5, 1.5], [Number.NaN, 15], [1.5, 100]]);
const ORDER = [0, 1, 2, 3];
const opts = (over: Partial<Parameters<typeof findCells>[1]> = {}) => ({ query: "", matchCase: false, wholeCell: false, ...over });

describe("findCells", () => {
  it("matches text inside a number, in display order (row by row, then column)", () => {
    const hits = findCells(D, opts({ query: "1.5" }), ORDER);
    // rows 0 (A=1.5), 1 (B=1.5), 3 (A=1.5); 15 does not contain "1.5"
    expect(hits).toEqual([{ row: 0, col: 0 }, { row: 1, col: 1 }, { row: 3, col: 0 }]);
  });

  it("whole cell compares the NUMBER, so 1.50 finds 1.5 but 1 does not find 10", () => {
    expect(findCells(D, opts({ query: "1.50", wholeCell: true }), ORDER)).toHaveLength(3);
    expect(findCells(D, opts({ query: "1", wholeCell: true }), ORDER).map((h) => [h.row, h.col])).toEqual([[0, -1]]);
    expect(findCells(D, opts({ query: "1", wholeCell: false }), ORDER).length).toBeGreaterThan(3);
  });

  it("an empty whole-cell query finds the missing (blank) cells; an empty partial query finds nothing", () => {
    expect(findCells(D, opts({ query: "", wholeCell: true }), ORDER)).toEqual([{ row: 2, col: 0 }]);
    expect(findCells(D, opts({ query: "" }), ORDER)).toEqual([]);
  });

  it("match case matters for exponent notation", () => {
    const d = data([0], [[1e-7, 5]]);
    expect(findCells(d, opts({ query: "E-7" }), [0])).toHaveLength(1);
    expect(findCells(d, opts({ query: "E-7", matchCase: true }), [0])).toHaveLength(0);
  });

  it("follows the display order and only the visible rows", () => {
    expect(findCells(D, opts({ query: "1.5" }), [3, 1]).map((h) => h.row)).toEqual([3, 1]);
  });

  it("limits to a row / column scope", () => {
    const hits = findCells(D, opts({ query: "1.5" }), ORDER, { rows: new Set([1, 3]), cols: new Set([0]) });
    expect(hits).toEqual([{ row: 3, col: 0 }]);
  });

  it("skips categorical columns (their cells are level codes, not what the grid shows)", () => {
    const d = { ...D, cat_levels: { 1: ["lo", "hi"] } } as DataStruct;
    expect(findCells(d, opts({ query: "1.5" }), ORDER).every((h) => h.col !== 1)).toBe(true);
  });
});

describe("replaceCells", () => {
  it("whole-cell replace writes the parsed number", () => {
    const hits = findCells(D, opts({ query: "1.5", wholeCell: true }), ORDER);
    const r = replaceCells(D, hits, opts({ query: "1.5", wholeCell: true }), "7", 2);
    expect(r.error).toBeNull();
    expect(r.edits).toEqual([{ row: 0, col: 0, value: 7 }, { row: 1, col: 1, value: 7 }, { row: 3, col: 0, value: 7 }]);
  });

  it("blank replacement clears to missing", () => {
    const r = replaceCells(D, [{ row: 0, col: 0 }], opts({ query: "1.5", wholeCell: true }), "", 2);
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0].value).toBeNaN();
  });

  it("partial replace is REFUSED by default: it would rewrite digits of numbers", () => {
    const hits = findCells(D, opts({ query: "0.1" }), ORDER);
    const r = replaceCells(data([0], [[-0.1752]]), hits, opts({ query: "0.1" }), "9", 2);
    expect(r.edits).toEqual([]);
    expect(r.error).toMatch(/edit its digits/);
  });

  it("with the explicit opt-in, partial replace edits the cell text, re-parses it, and reports the first change", () => {
    const o = opts({ query: "5", insideNumbers: true });
    const hits = findCells(D, o, ORDER);
    const r = replaceCells(D, hits, o, "0", 2);
    expect(r.first).toBe("1.5 → 1");
    const big = replaceCells(data([0], [[-0.1752]]), [{ row: 0, col: 0 }], opts({ query: "0.1", insideNumbers: true }), "9", 2);
    expect(big.first).toBe("-0.1752 → -9752");
    expect(r.edits.find((e) => e.row === 0 && e.col === 0)?.value).toBe(1);
    expect(r.edits.find((e) => e.row === 2 && e.col === 1)?.value).toBe(10);
    const bad = replaceCells(D, [{ row: 0, col: 0 }], opts({ query: "1", insideNumbers: true }), "x", 2);
    expect(bad.edits).toEqual([]);
    expect(bad.skipped).toBe(1);
  });

  it("refuses a whole-cell replacement that is not a number, before touching anything", () => {
    const r = replaceCells(D, [{ row: 0, col: 0 }], opts({ query: "1.5", wholeCell: true }), "abc", 2);
    expect(r.edits).toEqual([]);
    expect(r.error).toMatch(/not a number/);
  });

  it("leaves computed columns (col >= writable count) alone and counts them", () => {
    const r = replaceCells(D, [{ row: 0, col: 0 }, { row: 1, col: 1 }], opts({ query: "1.5", wholeCell: true }), "7", 1);
    expect(r.edits).toEqual([{ row: 0, col: 0, value: 7 }]);
    expect(r.readOnly).toBe(1);
  });
});
