// The live named-range link's resolver (lib/rangeLink.ts): what a window following a named range covers now, and every
// reason it refuses instead of widening. The export refuses a refused link with the same reason.
import { describe, expect, it } from "vitest";

import { windowFigureInputs } from "./figureRowRange";
import { resolveRangeLink } from "./rangeLink";
import type { NamedRange } from "./namedRanges";
import type { DataStruct, Dataset } from "./types";

const data = (n: number): DataStruct => ({ time: Array.from({ length: n }, (_v, i) => i), values: Array.from({ length: n }, (_v, i) => [i]), labels: ["a"], units: [""], metadata: {} });
const a: Dataset = { id: "a", name: "A.csv", data: data(20) };
const b: Dataset = { id: "b", name: "B.csv", data: data(5) };
const nr = (over: Partial<NamedRange> = {}): NamedRange => ({
  id: "nr1:x", name: "Base", scope: { kind: "sheet", datasetId: "a" }, target: { datasetId: "a", cols: [0], rows: { from: 3, to: 7 } }, ...over,
});

describe("resolveRangeLink", () => {
  it("covers the rows the name covers now, or every row for an unlimited range", () => {
    expect(resolveRangeLink("nr1:x", "a", [nr()], [a, b])).toEqual({ from: 3, to: 7, named: "nr1:x", namedAs: "Base" });
    expect(resolveRangeLink("nr1:x", "a", [nr({ target: { datasetId: "a", cols: [0], rows: null } })], [a, b])).toMatchObject({ from: 0, to: 19 });
  });

  it.each([
    ["a removed range", [] as NamedRange[], "a", /the named range was removed/],
    ["a stale range", [nr({ rowsStale: true })], "a", /rows were replaced/],
    ["a range with no columns left", [nr({ target: { datasetId: "a", cols: [], rows: null } })], "a", /every column of the block was deleted/],
    ["rows past the sheet's end", [nr({ target: { datasetId: "a", cols: [0], rows: { from: 18, to: 25 } } })], "a", /beyond the worksheet/],
    ["a range whose rows were all deleted", [nr({ target: { datasetId: "a", cols: [0], rows: { from: 3, to: 2, was: "rows 4-8" } } })], "a", /rows 4-8 no longer exist/],
    ["a window on another worksheet", [nr()], "b", /is on A\.csv, not on this worksheet/],
  ])("refuses %s, with no rows (never every row)", (_what, ranges, sheet, reason) => {
    const link = resolveRangeLink("nr1:x", sheet, ranges, [a, b], "Base");
    expect(link.refused).toMatch(reason);
    expect(link).toMatchObject({ from: 0, to: -1, named: "nr1:x", namedAs: "Base" });
  });

  it("the figure export refuses a refused link with its reason instead of exporting every row", () => {
    const link = resolveRangeLink("nr1:x", "a", [], [a], "Base");
    expect(() => windowFigureInputs({ rowRange: link, facetKey: null, xKey: null, yKeys: [0] }, a.data, {})).toThrow(/Plot row range: the named range was removed/);
  });
});
