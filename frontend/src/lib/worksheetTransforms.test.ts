import { describe, expect, it } from "vitest";

import type { DataStruct } from "./types";
import { joinWorksheets, stackWorksheet, transposeWorksheet, unstackWorksheet } from "./worksheetTransforms";

const wide: DataStruct = {
  time: [10, 20],
  values: [[1, 2], [3, 4]],
  labels: ["A", "B"],
  units: ["uA", "uB"],
  metadata: { sample: "S1" },
};

describe("worksheet transforms", () => {
  it("transposes the numeric matrix and preserves source schema as provenance", () => {
    const out = transposeWorksheet(wide);
    expect(out.time).toEqual([0, 1]);
    expect(out.values).toEqual([[1, 3], [2, 4]]);
    expect(out.labels).toEqual(["Row 1 (x=10)", "Row 2 (x=20)"]);
    expect(out.metadata.transpose_source_units).toEqual(["uA", "uB"]);
  });

  it("stacks selected columns to long form with searchable source labels", () => {
    const out = stackWorksheet(wide, [1, 0, 1, 99]);
    expect(out.time).toEqual([10, 10, 20, 20]);
    expect(out.values).toEqual([[1, 2], [0, 1], [1, 4], [0, 3]]);
    expect((out.metadata.origin_text_columns as Record<string, string[]>).Source).toEqual(["B", "A", "B", "A"]);
  });

  it("unstacks long data and applies the chosen duplicate aggregation", () => {
    const long: DataStruct = {
      time: [1, 1, 1, 2, 2],
      values: [[0, 10], [0, 14], [1, 20], [0, 30], [1, 40]],
      labels: ["category", "value"], units: ["", "K"], metadata: {},
    };
    const out = unstackWorksheet(long, -1, 0, 1, "mean");
    expect(out.time).toEqual([1, 2]);
    expect(out.values).toEqual([[12, 20], [30, 40]]);
    expect(out.labels).toEqual(["Category 0", "Category 1"]);
  });

  it("joins deterministically with missing values and collision-safe labels", () => {
    const right: DataStruct = {
      time: [20, 30], values: [[8, 80], [9, 90]], labels: ["A", "C"], units: ["rA", "rC"], metadata: {},
    };
    const out = joinWorksheets(wide, right, -1, -1, "full");
    expect(out.time).toEqual([10, 20, 30]);
    expect(out.labels).toEqual(["A", "B", "Right: A", "C"]);
    expect(out.values[0].slice(0, 2)).toEqual([1, 2]);
    expect(out.values[2].slice(2)).toEqual([9, 90]);
    expect(out.values[0][2]).toBeNaN();
  });

  it("refuses transforms that would explode worksheet dimensions", () => {
    const huge = { ...wide, time: Array.from({ length: 2_001 }, (_, i) => i), values: Array.from({ length: 2_001 }, () => [1, 2]) };
    expect(() => transposeWorksheet(huge)).toThrow(/2,000 output columns/);
  });

  // The safety claim ("refuses transforms likely to overwhelm the UI") has to
  // hold on the ROW axis, not just columns — these were the gaps.
  it("caps unstack on total output cells, not just columns", () => {
    // 2510 distinct keys x 2000 categories = 5.02M cells > 5M — must refuse,
    // even though neither axis alone trips the 2,000-column cap. Small input.
    const n = 2510;
    const long: DataStruct = {
      time: Array.from({ length: n }, (_, i) => i),
      // value columns: [key = i, category = i % 2000, value = 1]
      values: Array.from({ length: n }, (_, i) => [i, i % 2000, 1]),
      labels: ["key", "cat", "val"],
      units: ["", "", ""],
      metadata: {},
    };
    expect(() => unstackWorksheet(long, 0, 1, 2)).toThrow(/5,000,000 cells/);
  });

  it("caps join on the cheap input-row upper bound", () => {
    // The cap reads only time.length and throws before any iteration, so a
    // large time array with a tiny values array trips it fast.
    const big: DataStruct = {
      time: Array.from({ length: 5_000_001 }, (_, i) => i),
      values: [[0]],
      labels: ["key"], units: [""], metadata: {},
    };
    const small: DataStruct = { time: [0], values: [[0]], labels: ["key"], units: [""], metadata: {} };
    expect(() => joinWorksheets(big, small, 0, 0, "left")).toThrow(/5,000,000 rows/);
  });

  it("join excludes rows whose key is not finite (a non-finite key cannot match)", () => {
    // The KEY is value-column 0 (column index 0 = values[0], not time).
    const left: DataStruct = {
      time: [0, 1, 2], values: [[1, 10], [2, 20], [NaN, 30]],
      labels: ["k", "lv"], units: ["", ""], metadata: {},
    };
    const right: DataStruct = {
      time: [0, 1], values: [[1, 100], [2, 200]],
      labels: ["k", "rv"], units: ["", ""], metadata: {},
    };
    const out = joinWorksheets(left, right, 0, 0, "left");
    // The NaN-key left row is excluded — documented behavior, not silent.
    expect(out.time).toEqual([1, 2]);
  });
});
