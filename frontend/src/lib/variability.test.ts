import { describe, expect, it } from "vitest";

import type { DataStruct } from "./types";
import { buildNestedLevels, toWireGroups } from "./variability";

// Same balanced 2-per-A, 3-per-cell design as the backend's own
// tests/test_api_stats_varcomp.py _BALANCED fixture.
const DATA: DataStruct = {
  time: Array.from({ length: 18 }, (_, i) => i),
  values: [
    [0, 0, 2], [0, 0, 4], [0, 0, 6],
    [0, 1, 4], [0, 1, 6], [0, 1, 8],
    [1, 0, 6], [1, 0, 8], [1, 0, 10],
    [1, 1, 8], [1, 1, 10], [1, 1, 12],
    [2, 0, 10], [2, 0, 12], [2, 0, 14],
    [2, 1, 12], [2, 1, 14], [2, 1, 16],
  ],
  labels: ["lot", "wafer", "measurement"],
  units: ["", "", ""],
  metadata: {},
};

describe("buildNestedLevels / toWireGroups", () => {
  it("groups a balanced 3-lot x 2-wafer design into the backend's nested wire shape", () => {
    const levels = buildNestedLevels(DATA, 2, 0, 1);
    expect(levels.map((l) => l.aLabel)).toEqual(["0", "1", "2"]);
    expect(levels.map((l) => l.cells.map((c) => c.bLabel))).toEqual([["0", "1"], ["0", "1"], ["0", "1"]]);
    expect(toWireGroups(levels)).toEqual([
      [[2, 4, 6], [4, 6, 8]],
      [[6, 8, 10], [8, 10, 12]],
      [[10, 12, 14], [12, 14, 16]],
    ]);
  });

  it("drops a cell with zero finite response values, and an A-level left with zero cells", () => {
    const withGaps: DataStruct = {
      ...DATA,
      values: DATA.values.map((r) => (r[0] === 2 ? [r[0], r[1], NaN] : r)), // A=2 entirely non-finite response
    };
    const levels = buildNestedLevels(withGaps, 2, 0, 1);
    expect(levels.map((l) => l.aLabel)).toEqual(["0", "1"]); // A=2 dropped
  });

  it("re-indexes aIndex/bIndex to consecutive 0..n-1 after drops", () => {
    const withGaps: DataStruct = {
      ...DATA,
      values: DATA.values.map((r) => (r[0] === 0 ? [r[0], r[1], NaN] : r)), // A=0 dropped
    };
    const levels = buildNestedLevels(withGaps, 2, 0, 1);
    expect(levels[0].aIndex).toBe(0);
    expect(levels[0].aLabel).toBe("1");
    expect(levels[0].cells.map((c) => c.bIndex)).toEqual([0, 1]);
  });

  it("a single A-level (nesting design needs >=2) still returns that one level — caller checks levels.length<2", () => {
    const oneLevel: DataStruct = { ...DATA, values: DATA.values.map((r) => [0, r[1], r[2]]) };
    const levels = buildNestedLevels(oneLevel, 2, 0, 1);
    expect(levels.length).toBe(1);
  });
});

// Group O-2 review, MEDIUM 5: the defect this module's own comment predicted.
// Factor A comes from `categoryLevels` (order-aware); factor B must too, or one
// chart shows two orders and the b_index sequence on the calc.stats_varcomp
// wire disagrees with the A axis beside it.
describe("variability honours the level order on BOTH factors (Group O-2)", () => {
  const data: DataStruct = {
    time: [1, 2, 3, 4, 5, 6, 7, 8],
    values: [
      [0, 0, 1],
      [0, 1, 2],
      [1, 0, 3],
      [1, 1, 4],
      [0, 0, 5],
      [0, 1, 6],
      [1, 0, 7],
      [1, 1, 8],
    ],
    labels: ["lot", "wafer", "y"],
    units: ["", "", ""],
    metadata: {},
    cat_levels: { 0: ["a0", "a1"], 1: ["b0", "b1"] },
  };

  it("reverses factor B with its order, not just factor A", () => {
    const ordered: DataStruct = { ...data, level_order: { 0: [1, 0], 1: [1, 0] } };
    const levels = buildNestedLevels(ordered, 2, 0, 1);
    expect(levels.map((l) => [l.aLabel, l.cells.map((c) => c.bLabel)])).toEqual([
      ["a1", ["b1", "b0"]],
      ["a0", ["b1", "b0"]],
    ]);
  });

  it("is ascending on both factors without an order — unchanged behaviour", () => {
    const levels = buildNestedLevels(data, 2, 0, 1);
    expect(levels.map((l) => [l.aLabel, l.cells.map((c) => c.bLabel)])).toEqual([
      ["a0", ["b0", "b1"]],
      ["a1", ["b0", "b1"]],
    ]);
  });

  it("orders factor B alone when only B has an order (the measured mismatch)", () => {
    const ordered: DataStruct = { ...data, level_order: { 1: [1, 0] } };
    const levels = buildNestedLevels(ordered, 2, 0, 1);
    expect(levels.map((l) => [l.aLabel, l.cells.map((c) => c.bLabel)])).toEqual([
      ["a0", ["b1", "b0"]],
      ["a1", ["b1", "b0"]],
    ]);
  });
});

// Review finding 1: `VariabilityCell.rowIds` (index-aligned with `values`)
// is the jitter key `VariabilityChart.tsx` reads, so it must survive exactly
// the same exclusion/reshuffle scenario the box/strip fix (lib/jitter.ts,
// lib/statstage.resolveGroupsIndexed) already covers.
describe("buildNestedLevels rowIds — the ORIGINAL dataset row behind each cell value", () => {
  it("defaults to the identity (rowIds[i] === i) when no mapping is given", () => {
    const levels = buildNestedLevels(DATA, 2, 0, 1);
    // Cell (A=0, B=0) is rows 0,1,2 of DATA (values 2,4,6).
    expect(levels[0].cells[0].rowIds).toEqual([0, 1, 2]);
  });

  it("maps every cell's values back to their TRUE original row when given the analysis view's rowIds", () => {
    // Row 4 (A=0, B=1, value 6) is dropped from the analysis view — every row
    // after it shifts down by one position in `view`. Without the mapping, a
    // consumer keying by position would report row 4's neighbour (row 5) as
    // if it were row 4.
    const view: DataStruct = {
      ...DATA,
      time: DATA.time.filter((_, i) => i !== 4),
      values: DATA.values.filter((_, i) => i !== 4),
    };
    const rowIds = DATA.time.filter((_, i) => i !== 4); // = [0,1,2,3,5,6,...,17]
    const levels = buildNestedLevels(view, 2, 0, 1, rowIds);
    // Cell (A=0, B=1) in `view` now holds only original rows 3 and 5
    // (value 4 at row 3, value 8 at row 5 — row 4's value 6 is gone).
    const cell = levels[0].cells[1];
    expect(cell.values).toEqual([4, 8]);
    expect(cell.rowIds).toEqual([3, 5]);
  });

  it("excluding an UNRELATED row leaves every other cell's rowIds (and hence jitter key) unchanged", () => {
    // Row 4 sits in cell (A=0, B=1) — every OTHER cell's rows are untouched by
    // its removal, and this pins that: cell (A=1, B=0)'s rowIds must be
    // EXACTLY what they were before, not shifted down by one.
    const before = buildNestedLevels(DATA, 2, 0, 1).find((l) => l.aLabel === "1")!.cells[0].rowIds;
    const view: DataStruct = {
      ...DATA,
      time: DATA.time.filter((_, i) => i !== 4),
      values: DATA.values.filter((_, i) => i !== 4),
    };
    const rowIds = DATA.time.filter((_, i) => i !== 4);
    const after = buildNestedLevels(view, 2, 0, 1, rowIds).find((l) => l.aLabel === "1")!.cells[0].rowIds;
    expect(after).toEqual(before);
  });
});

describe("the nestedLevels extraction is behaviour-preserving where it could not be", () => {
  it("response = the x column, with time SHORTER than values", () => {
    // `buildNestedLevels` bounds rows by min(A, B, RESPONSE); the extracted
    // `nestedLevels` only knows the factors, so it bounds by min(A, B). They
    // differ exactly here — and the rows in the gap have an undefined response,
    // so the cells they would add are empty and dropped. Pinned so a future
    // change to either bound cannot quietly start emitting them.
    const d: DataStruct = {
      time: [1, 2],
      values: [
        [0, 0],
        [0, 1],
        [1, 2],
      ],
      labels: ["lot", "wafer"],
      units: ["", ""],
      metadata: {},
    };
    const out = buildNestedLevels(d, -1, 0, 1);
    expect(out).toHaveLength(1);
    expect(out[0].aLabel).toBe("0");
    expect(out[0].cells.map((c) => c.values)).toEqual([[1], [2]]);
  });
});
