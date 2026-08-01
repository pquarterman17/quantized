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
