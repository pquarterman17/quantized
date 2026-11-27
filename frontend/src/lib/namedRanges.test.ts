// The pure named-range model (ROW_RANGE_CONTRACT section 5): the clash rule on Append, and the remaps' identity
// guarantee (the same array when nothing changed, so a store write is skipped).

import { describe, expect, it } from "vitest";

import {
  markNamedRangesRowsStale,
  namedRangeNameRefusal,
  namedRangeNewNameRefusal,
  remapNamedRangeColumns,
  shiftNamedRangesForDelete,
  sanitizeNamedRanges,
  shiftNamedRangesForInsert,
  type NamedRange,
} from "./namedRanges";
import { appendNamedRanges } from "./namedRangesAppend";

const range = (id: string, name: string, over: Partial<NamedRange> = {}): NamedRange => ({
  id,
  name,
  scope: { kind: "workbook", workbookId: "w" },
  target: { datasetId: "a", cols: [0, 1], rows: { from: 2, to: 5 } },
  ...over,
});

describe("Append: the clash rule", () => {
  const after = [{ id: "a", workbookId: "w" }, { id: "n", workbookId: "w" }];

  it("an incoming name already taken within its workbook becomes 'name (2)', then '(3)'; the count says so; nothing is merged", () => {
    const existing = [range("nr1:x", "Base"), range("nr1:y", "Base (2)")];
    const r = appendNamedRanges(existing, [range("nr1:in", "base", { target: { datasetId: "n", cols: [0], rows: null } })], new Map([["n", "n"]]), new Map([["w", "w"]]), after);
    expect(r.ranges.map((x) => x.name)).toEqual(["base (3)"]);
    expect(r).toMatchObject({ dropped: 0, renamed: 1 });
  });

  it("two incoming ranges with the same name clash with each other too", () => {
    const r = appendNamedRanges([], [range("nr1:1", "Dup"), range("nr1:2", "Dup")], new Map([["a", "a"]]), new Map([["w", "w"]]), after);
    expect(r.ranges.map((x) => x.name)).toEqual(["Dup", "Dup (2)"]);
  });

  it("a name that fits in 64 characters is kept at 64 when the suffix is added", () => {
    const long = "x".repeat(64);
    const r = appendNamedRanges([range("nr1:x", long)], [range("nr1:in", long)], new Map([["a", "a"]]), new Map([["w", "w"]]), after);
    expect(r.ranges[0].name).toHaveLength(64);
    expect(r.ranges[0].name.endsWith("(2)")).toBe(true);
  });

  it("a range whose worksheet or workbook did not come along is dropped, never re-pointed", () => {
    const r = appendNamedRanges([], [range("nr1:1", "A"), range("nr1:2", "B", { scope: { kind: "workbook", workbookId: "gone" } })], new Map([["a", "a2"]]), new Map([["w", "w2"]]), [{ id: "a2", workbookId: "w2" }]);
    expect(r.ranges.map((x) => x.name)).toEqual(["A"]);
    expect(r.ranges[0].target.datasetId).toBe("a2");
    expect(r.dropped).toBe(1);
  });
});

describe("remaps return the SAME array when nothing changes", () => {
  const list = [range("nr1:1", "A")];
  it("a column shift on another sheet, a row shift on another sheet, rows with no limit, a stale range", () => {
    expect(remapNamedRangeColumns(list, "other", 0)).toBe(list);
    expect(shiftNamedRangesForInsert(list, "other", 0, 1)).toBe(list);
    expect(shiftNamedRangesForDelete(list, "other", new Set([0]))).toBe(list);
    const unlimited = [range("nr1:2", "U", { target: { datasetId: "a", cols: [0], rows: null } })];
    expect(shiftNamedRangesForInsert(unlimited, "a", 0, 1)).toBe(unlimited);
    const stale = [range("nr1:3", "S", { rowsStale: true })];
    expect(shiftNamedRangesForInsert(stale, "a", 0, 1)).toBe(stale);
    expect(markNamedRangesRowsStale(stale, "a")).toBe(stale);
    expect(markNamedRangesRowsStale(unlimited, "a")).toBe(unlimited);
  });

  it("marking stale flags only the row-limited ranges of that sheet", () => {
    const mixed = [range("nr1:1", "A"), range("nr1:2", "B", { target: { datasetId: "a", cols: [0], rows: null } }), range("nr1:3", "C", { target: { datasetId: "z", cols: [0], rows: { from: 0, to: 1 } } })];
    expect(markNamedRangesRowsStale(mixed, "a").map((r) => !!r.rowsStale)).toEqual([true, false, false]);
  });
});

describe("names that look like cell references", () => {
  it("a new name is refused when it is one to three letters then digits", () => {
    for (const bad of ["A1", "a1", "ab12", "XFD1048576", "Z99"]) expect(namedRangeNewNameRefusal(bad), bad).toMatch(/looks like a cell reference/);
    for (const ok of ["Base", "Base1", "A1b", "ABCD1", "A_1", "1A", "x", "R1C1x"]) expect(namedRangeNewNameRefusal(ok), ok).toBeNull();
    expect(namedRangeNewNameRefusal("")).toBe("give the range a name");
  });

  it("a range already saved as A1 still loads, so no file loses one", () => {
    expect(namedRangeNameRefusal("A1")).toBeNull();
    const kept = sanitizeNamedRanges([range("r1", "A1", { scope: { kind: "sheet", datasetId: "a" } })], [{ id: "a", name: "a", data: { time: [0], values: [[1, 2]], labels: ["A", "B"], units: ["", ""], metadata: {} } }], []);
    expect(kept.map((r) => r.name)).toEqual(["A1"]);
  });
});
