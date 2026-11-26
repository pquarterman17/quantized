// Fill series (plan item 29): number and date series, and every way it must refuse.

import { describe, expect, it } from "vitest";

import { addMonths, seriesEdits, type SeriesRequest } from "./gridSeries";
import { makeEpoch, parseIsoDate } from "./formulaCalendar";

const d = (iso: string) => parseIsoDate(iso);
/** A grid of rows x cols; column -1 is X. */
function req(grid: Record<number, (number | null)[]>, over: Partial<SeriesRequest> = {}): SeriesRequest {
  const rows = Math.max(...Object.values(grid).map((c) => c.length));
  return {
    rows: Array.from({ length: rows }, (_, i) => i),
    cols: Object.keys(grid).map(Number),
    direction: "down",
    valueAt: (r, c) => grid[c]?.[r],
    bounds: { rows, writableCols: 4 },
    isDateCol: (c) => c === -1 && over.unit !== undefined,
    colName: (c) => `c${c}`,
    ...over,
  };
}
const values = (r: ReturnType<typeof seriesEdits>) => ("edits" in r ? r.edits.map((e) => [e.row, e.col, e.value]) : r.problem);

describe("number series", () => {
  it("takes the step from the first two cells and starts filling at the third", () => {
    expect(values(seriesEdits(req({ 0: [10, 12, null, null, null] })))).toEqual([[2, 0, 14], [3, 0, 16], [4, 0, 18]]);
  });
  it("a single seed steps by 1", () => {
    expect(values(seriesEdits(req({ 0: [5, null, null] })))).toEqual([[1, 0, 6], [2, 0, 7]]);
  });
  it("a negative or fractional step, with no float drift", () => {
    const r = seriesEdits(req({ 0: [1, 1.1, null, null] }));
    expect(values(r)).toEqual([[2, 0, 1 + 2 * (1.1 - 1)], [3, 0, 1 + 3 * (1.1 - 1)]]);
    expect(values(seriesEdits(req({ 0: [0, -2, null] })))).toEqual([[2, 0, -4]]);
  });
  it("fills each column of the selection on its own", () => {
    expect(values(seriesEdits(req({ 0: [1, null, null], 1: [10, 20, null] })))).toEqual([[1, 0, 2], [2, 0, 3], [2, 1, 30]]);
  });
  it("fills across by rows, from the leftmost cells", () => {
    const grid = { 0: [1, 100], 1: [2, null], 2: [null, null] };
    expect(values(seriesEdits(req(grid, { direction: "across" })))).toEqual([[0, 2, 3], [1, 1, 101], [1, 2, 102]]);
  });
  it("overwrites cells after the seeds, including a stray third value", () => {
    expect(values(seriesEdits(req({ 0: [1, 2, 99, null] })))).toEqual([[2, 0, 3], [3, 0, 4]]);
  });
  it("treats a NaN second cell as blank", () => {
    expect(values(seriesEdits(req({ 0: [3, Number.NaN, null] })))).toEqual([[1, 0, 4], [2, 0, 5]]);
  });
});

describe("fails closed", () => {
  it("a blank start", () => expect(values(seriesEdits(req({ 0: [null, 1, null] })))).toMatch(/first cell of "c0" is blank/));
  it("one cell along the direction", () => expect(values(seriesEdits(req({ 0: [1] })))).toMatch(/at least two cells in a column/));
  it("only the seeds selected", () => expect(values(seriesEdits(req({ 0: [1, 2] })))).toMatch(/only the start values/));
  it("a text column anywhere in the selection writes nothing at all", () => {
    const r = req({ 0: [1, null, null], 1: [1, null, null] }, { bounds: { rows: 3, writableCols: 4, levelsAt: (c) => (c === 1 ? ["a"] : null) } });
    expect(values(seriesEdits(r))).toMatch(/"c1" is a text column/);
  });
  it("a computed column", () => {
    const r = req({ 0: [1, null, null] }, { bounds: { rows: 3, writableCols: 0 } });
    expect(values(seriesEdits(r))).toMatch(/computed/);
  });
  it("a blank start in one column refuses the other columns too", () => {
    expect(values(seriesEdits(req({ 0: [1, null, null], 1: [null, null, null] })))).toMatch(/"c1" is blank/);
  });
  it("a date column in a number fill, and numbers in a date fill", () => {
    expect(values(seriesEdits(req({ [-1]: [1, null] }, { isDateCol: (c) => c === -1 })))).toMatch(/holds dates/);
    expect(values(seriesEdits(req({ [-1]: [1, null], 0: [1, null] }, { unit: "day", isDateCol: (c) => c === -1 })))).toMatch(/"c0" holds numbers/);
  });
});

describe("date series", () => {
  const col = (vals: (number | null)[], unit: "day" | "week" | "month" | "year") => seriesEdits(req({ [-1]: vals }, { unit }));
  const iso = (r: ReturnType<typeof seriesEdits>) => ("edits" in r ? r.edits.map((e) => new Date(e.value * 1000).toISOString().slice(0, 10)) : r.problem);

  it("steps by day, and by week, from a single seed", () => {
    expect(iso(col([d("2026-02-27"), null, null, null], "day"))).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(iso(col([d("2026-01-01"), null, null], "week"))).toEqual(["2026-01-08", "2026-01-15"]);
  });
  it("takes the step from two dates", () => {
    expect(iso(col([d("2026-01-01"), d("2026-01-04"), null, null], "day"))).toEqual(["2026-01-07", "2026-01-10"]);
  });
  it("month ends clamp but do not carry: Jan 31 + 1 month is Feb 28 (29 in a leap year)", () => {
    expect(iso(col([d("2026-01-31"), null, null, null, null], "month"))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(iso(col([d("2028-01-31"), null], "month"))).toEqual(["2028-02-29"]);
  });
  it("two month-end dates a clamped month apart count as one month", () => {
    expect(iso(col([d("2026-01-31"), d("2026-02-28"), null, null], "month"))).toEqual(["2026-03-31", "2026-04-30"]);
  });
  it("years, with 29 February clamping to 28", () => {
    expect(iso(col([d("2028-02-29"), null, null, null, null], "year"))).toEqual(["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });
  it("keeps the time of day", () => {
    const r = col([d("2026-01-31T13:45:10"), null], "month");
    expect("edits" in r && r.edits[0].value).toBe(makeEpoch(2026, 2, 28, 13, 45, 10));
  });
  it("two dates that are not a whole unit apart refuse", () => {
    expect(col([d("2026-01-01"), d("2026-01-01T12:00:00"), null], "day")).toMatchObject({ problem: expect.stringMatching(/whole number of days/) });
    expect(col([d("2026-01-15"), d("2026-02-20"), null], "month")).toMatchObject({ problem: expect.stringMatching(/whole number of months/) });
    expect(col([d("2026-01-15"), d("2027-03-15"), null], "year")).toMatchObject({ problem: expect.stringMatching(/whole number of years/) });
  });
  it("a series that leaves years 1..9999 refuses", () => {
    expect(col([d("9999-12-30"), null, null], "day")).toMatchObject({ problem: expect.stringMatching(/out of range/) });
    expect(Number.isNaN(addMonths(d("9999-12-01"), 1))).toBe(true);
  });
});

describe("date series: step unit read from the first two cells", () => {
  const auto = (grid: Record<number, (number | null)[]>, over: Partial<SeriesRequest> = {}) =>
    values(seriesEdits(req(grid, { unit: "auto", ...over })));
  const iso = (r: ReturnType<typeof seriesEdits>) => ("edits" in r ? r.edits.map((e) => new Date(e.value * 1000).toISOString().slice(0, 10)) : r.problem);
  const run = (a: string, b: string, n = 4) => iso(seriesEdits(req({ [-1]: [d(a), d(b), ...Array(n - 2).fill(null)] }, { unit: "auto" })));

  it("picks day, week, month and year", () => {
    expect(run("2026-03-01", "2026-03-04")).toEqual(["2026-03-07", "2026-03-10"]);
    expect(run("2026-03-01", "2026-03-15")).toEqual(["2026-03-29", "2026-04-12"]);
    expect(run("2026-03-05", "2026-04-05")).toEqual(["2026-05-05", "2026-06-05"]);
    expect(run("2026-03-05", "2028-03-05")).toEqual(["2030-03-05", "2032-03-05"]);
  });
  it("a clamped month end is still months, and clamping does not carry", () => {
    expect(run("2026-01-31", "2026-02-28", 5)).toEqual(["2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(run("2024-02-29", "2025-02-28")).toEqual(["2026-02-28", "2027-02-28"]);
  });
  it("a descending pair steps backwards", () => {
    expect(run("2026-03-10", "2026-03-03")).toEqual(["2026-02-24", "2026-02-17"]);
  });
  it("fills ACROSS a row", () => {
    const grid = { 0: [d("2026-03-01")], 1: [d("2026-04-01")], 2: [null], 3: [null] };
    const r = seriesEdits(req(grid, { unit: "auto", direction: "across", isDateCol: () => true }));
    expect(iso(r)).toEqual(["2026-05-01", "2026-06-01"]);
    expect("edits" in r && r.edits.map((e) => [e.row, e.col])).toEqual([[0, 2], [0, 3]]);
  });
  it("each row detects its own unit", () => {
    const r = seriesEdits(req({ 0: [d("2026-03-01"), d("2026-03-01")], 1: [d("2026-03-02"), d("2026-04-01")], 2: [null, null], 3: [null, null] }, { unit: "auto", direction: "across", isDateCol: () => true, rows: [0, 1], bounds: { rows: 2, writableCols: 4 } }));
    expect(iso(r)).toEqual(["2026-03-03", "2026-03-04", "2026-05-01", "2026-06-01"]);
  });
  it("asks for a unit when the two cells fit none, are equal, or the second is blank", () => {
    expect(auto({ [-1]: [d("2026-03-01"), d("2026-03-01") + 3600, null] })).toMatch(/fit no whole.*choose a unit/);
    expect(auto({ [-1]: [d("2026-03-01"), d("2026-03-01"), null] })).toMatch(/equal.*choose a unit/);
    expect(auto({ [-1]: [d("2026-03-01"), null, null] })).toMatch(/second cell can't be blank/);
  });
  it("still refuses a number column and a blank start", () => {
    expect(auto({ 0: [1, 2, null] }, { isDateCol: () => false })).toMatch(/holds numbers/);
    expect(auto({ [-1]: [null, d("2026-03-01"), null] })).toMatch(/blank/);
  });
  it("a date range that leaves years 1..9999 refuses", () => {
    expect(run("9998-01-01", "9999-01-01")).toMatch(/runs out of range/);
  });
});
