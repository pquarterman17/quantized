// The pure halves of the Name box and the manager's Retarget form: what a selection is as a block, which names a sheet
// can see, what Enter would do with a typed name, and how typed columns and rows are read (refused, never repaired).
import { describe, expect, it } from "vitest";

import type { NamedRange } from "../../../lib/namedRanges";
import { describeBlock, planNameBox, rangeNamingBlock, selectedBlock, visibleRanges } from "./nameBoxModel";
import { columnSpecText, letterIndex, parseColumnSpec, parseRowSpec } from "./rangeSpec";

const range = (id: string, name: string, scope: NamedRange["scope"], over: Partial<NamedRange["target"]> = {}): NamedRange => ({
  id, name, scope, target: { datasetId: "s1", cols: [0, 1], rows: { from: 3, to: 9 }, ...over },
});
const sheets = [{ id: "s1", workbookId: "w1" }, { id: "s2", workbookId: "w1" }, { id: "solo" }];

describe("selectedBlock", () => {
  it("is null with nothing selected", () => {
    expect(selectedBlock({ cell: null, rows: new Set(), cols: new Set(), width: 3 })).toBeNull();
  });
  it("takes a contiguous row selection and the selected columns", () => {
    expect(selectedBlock({ cell: null, rows: new Set([5, 4, 3]), cols: new Set([1, 0]), width: 3 })).toEqual({ cols: [0, 1], rows: { from: 3, to: 5 } });
  });
  it("a row-only selection covers every value column; a column-only selection covers every row", () => {
    expect(selectedBlock({ cell: null, rows: new Set([2, 3]), cols: new Set(), width: 3 })).toEqual({ cols: [0, 1, 2], rows: { from: 2, to: 3 } });
    expect(selectedBlock({ cell: null, rows: new Set(), cols: new Set([2]), width: 3 })).toEqual({ cols: [2], rows: null });
  });
  it("refuses gaps in the rows, naming them (the contiguity rule of the contract)", () => {
    expect(selectedBlock({ cell: null, rows: new Set([1, 2, 5]), cols: new Set([0]), width: 3 })).toEqual({
      reason: "the selection has gaps (rows 2-3, 6): use Extract rows, or Exclude others",
    });
  });
  it("reads a cell rectangle as source rows and channels (X is -1)", () => {
    expect(selectedBlock({ cell: { rows: [7, 8], cols: [-1, 0] }, rows: new Set(), cols: new Set(), width: 3 })).toEqual({ cols: [-1, 0], rows: { from: 7, to: 8 } });
    expect("reason" in (selectedBlock({ cell: { rows: [], cols: [0] }, rows: new Set(), cols: new Set(), width: 3 }) as object)).toBe(true);
  });
});

describe("visibleRanges and rangeNamingBlock", () => {
  const ranges = [range("a", "OnS1", { kind: "sheet", datasetId: "s1" }), range("b", "WB", { kind: "workbook", workbookId: "w1" }), range("c", "OnS2", { kind: "sheet", datasetId: "s2" }, { datasetId: "s2" })];
  it("a sheet sees its own sheet names and its workbook's names, nothing else", () => {
    expect(visibleRanges(ranges, sheets[0]).map((r) => r.name)).toEqual(["OnS1", "WB"]);
    expect(visibleRanges(ranges, sheets[1]).map((r) => r.name)).toEqual(["WB", "OnS2"]);
    expect(visibleRanges(ranges, sheets[2])).toEqual([]);
  });
  it("names a block exactly: same columns (any order) and same rows; a stale range names nothing", () => {
    const visible = visibleRanges(ranges, sheets[0]);
    expect(rangeNamingBlock({ cols: [1, 0], rows: { from: 3, to: 9 } }, visible, "s1")?.name).toBe("OnS1");
    expect(rangeNamingBlock({ cols: [0, 1], rows: { from: 3, to: 8 } }, visible, "s1")).toBeUndefined();
    expect(rangeNamingBlock({ cols: [0, 1], rows: null }, visible, "s1")).toBeUndefined();
    const stale = [{ ...ranges[0], rowsStale: true as const }];
    expect(rangeNamingBlock({ cols: [0, 1], rows: { from: 3, to: 9 } }, stale, "s1")).toBeUndefined();
  });
});

describe("planNameBox", () => {
  const ranges = [range("a", "Base", { kind: "sheet", datasetId: "s1" }), range("c", "Other", { kind: "sheet", datasetId: "s2" }, { datasetId: "s2" })];
  const block = { cols: [0], rows: { from: 1, to: 4 } };
  const plan = (typed: string, scope: "sheet" | "workbook" = "sheet", b: Parameters<typeof planNameBox>[2] = block, ds = sheets[0]) => planNameBox(typed, scope, b, ranges, sheets, ds);
  it("empty text does nothing", () => expect(plan("  ")).toEqual({ kind: "idle" }));
  it("an existing visible name goes to it, without regard to case", () => expect(plan("base")).toMatchObject({ kind: "go", range: { id: "a" } }));
  it("a new legal name is defined", () => expect(plan(" Fresh ")).toEqual({ kind: "define", name: "Fresh", scope: "sheet" }));
  it("refuses an illegal name, a name taken on a sibling sheet of the workbook, and a workbook scope on a loose sheet", () => {
    expect(plan('has"quote')).toMatchObject({ kind: "refused", reason: expect.stringMatching(/quotes/) });
    expect(plan("other")).toMatchObject({ kind: "refused", reason: expect.stringMatching(/"Other" is already a named range in this workbook/) });
    expect(plan("Loose", "workbook", block, sheets[2])).toMatchObject({ kind: "refused", reason: expect.stringMatching(/no workbook/) });
  });
  it("refuses with no selection and with a selection that is not a block", () => {
    expect(plan("Fresh", "sheet", null)).toMatchObject({ kind: "refused", reason: expect.stringMatching(/select the cells/) });
    expect(plan("Fresh", "sheet", { reason: "the selection has gaps" })).toEqual({ kind: "refused", reason: "the selection has gaps" });
  });
  it("describes a block in the worksheet's words", () => {
    expect(describeBlock({ cols: [0, 1], rows: { from: 3, to: 9 } })).toBe("A:B rows 4-10");
    expect(describeBlock({ cols: [-1], rows: null })).toBe("X every row");
  });
});

describe("column and row entries", () => {
  it("reads letters, ranges and the x column; letterIndex inverts channelLetter", () => {
    expect(parseColumnSpec("B:C", 5)).toEqual({ cols: [1, 2] });
    expect(parseColumnSpec("A, c", 5)).toEqual({ cols: [0, 2] });
    expect(parseColumnSpec("x, B", 5)).toEqual({ cols: [-1, 1] });
    expect(letterIndex("AB")).toBe(27);
    expect(letterIndex("a1")).toBeNull();
  });
  it("refuses a column off the sheet, a repeat, a backwards range and nonsense", () => {
    expect(parseColumnSpec("F", 5)).toEqual({ reason: "column F is not on the worksheet (it has 5)" });
    expect(parseColumnSpec("A, A", 5)).toEqual({ reason: "column A is listed twice" });
    expect(parseColumnSpec("C:A", 5)).toEqual({ reason: '"C:A" runs backwards' });
    expect(parseColumnSpec("1", 5)).toEqual({ reason: '"1" is not a column or a column range' });
    expect(parseColumnSpec("  ", 5)).toMatchObject({ reason: expect.stringMatching(/enter the columns/) });
  });
  it("writes columns back as text it can read", () => {
    for (const cols of [[0, 1, 2], [-1, 1], [0, 2, 3, 4], [3]]) expect(parseColumnSpec(columnSpecText(cols), 9)).toEqual({ cols });
  });
  it("rows are 1-based; both blank is every row; one blank, zero and reversed are refused", () => {
    expect(parseRowSpec("21", "44")).toEqual({ rows: { from: 20, to: 43 } });
    expect(parseRowSpec("", " ")).toEqual({ rows: null });
    expect(parseRowSpec("21", "")).toMatchObject({ reason: expect.stringMatching(/both rows/) });
    expect(parseRowSpec("0", "5")).toMatchObject({ reason: expect.stringMatching(/from 1/) });
    expect(parseRowSpec("9", "5")).toMatchObject({ reason: expect.stringMatching(/must not come after/) });
  });
});
