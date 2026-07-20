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
  it("caps transpose on BOTH output axes, not just rows", () => {
    // rows (2000, at the column cap) x channels (4096) = 8.19M cells > 5M.
    const wideDetector: DataStruct = {
      time: Array.from({ length: 2000 }, (_, i) => i),
      values: Array.from({ length: 2000 }, () => Array.from({ length: 4096 }, () => 1)),
      labels: Array.from({ length: 4096 }, (_, i) => `ch${i}`),
      units: Array.from({ length: 4096 }, () => ""),
      metadata: {},
    };
    expect(() => transposeWorksheet(wideDetector)).toThrow(/5,000,000 cells/);
  });

  it("strips stale date/x-axis metadata so a reshape can't re-open the date gate", () => {
    // A datetime dataset transposed has a channel-index X — it is NOT a date
    // axis, so time_is_datetime must not survive (it would let TickFormat offer
    // date formatting on non-date data, and feed the date formatter huge
    // values).
    const dated: DataStruct = {
      time: [1e9, 2e9],
      values: [[1], [2]],
      labels: ["y"],
      units: [""],
      metadata: { time_is_datetime: true, time_timezone: "UTC", x_column_name: "t", sample: "S1" },
    };
    const out = transposeWorksheet(dated);
    expect(out.metadata.time_is_datetime).toBeUndefined();
    expect(out.metadata.time_timezone).toBeUndefined();
    expect(out.metadata.x_column_name).toBeUndefined();
    // Non-axis provenance is preserved.
    expect(out.metadata.sample).toBe("S1");
  });

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

  it("unstack emits an ASCENDING x even when the key column is unsorted", () => {
    // uPlot reads the last x as the axis max (it assumes ascending x — the same
    // invariant dropTrailingEmptyRows protects for imports). First-appearance
    // key order emitted [20, 10] here and collapsed the plotted range.
    const long: DataStruct = {
      time: [0, 0, 0, 0],
      values: [[20, 0, 5], [10, 0, 7], [20, 1, 9], [10, 1, 11]],
      labels: ["key", "cat", "val"], units: ["", "", ""], metadata: {},
    };
    const out = unstackWorksheet(long, 0, 1, 2);
    expect(out.time).toEqual([10, 20]);
    // Values must follow the sorted keys, not the encounter order.
    expect(out.values).toEqual([[7, 11], [5, 9]]);
  });

  it("join emits an ASCENDING x, including right-only keys in a full join", () => {
    // `full` appended right-only keys after ALL left keys regardless of value,
    // so a right side holding lower keys produced a non-monotonic x.
    const left: DataStruct = {
      time: [0, 1], values: [[10, 1], [30, 3]],
      labels: ["k", "lv"], units: ["", ""], metadata: {},
    };
    const right: DataStruct = {
      time: [0, 1, 2], values: [[5, 50], [20, 200], [30, 300]],
      labels: ["k", "rv"], units: ["", ""], metadata: {},
    };
    const out = joinWorksheets(left, right, 0, 0, "full");
    expect(out.time).toEqual([5, 10, 20, 30]);
    // Row for key 30 carries BOTH sides; key 5 is right-only (left = NaN).
    expect(out.values[3]).toEqual([3, 300]);
    expect(out.values[0][0]).toBeNaN();
    expect(out.values[0][1]).toBe(50);
  });

  it("unstack aggregates duplicates in O(1) per row, not by collecting them", () => {
    // Regression guard for a quadratic accumulator: every row shared ONE cell,
    // so `[...bucket, v]` per row made a trivial 1x1 output cost O(n^2)
    // (~3.5 s at 40k rows, minutes at 200k) with no cap able to trip. The
    // bound is deliberately loose — it separates O(n) from O(n^2), and CI
    // Windows runs several times slower than local.
    const n = 100_000;
    const long: DataStruct = {
      time: Array.from({ length: n }, () => 0),
      values: Array.from({ length: n }, (_, i) => [7, 3, i]),
      labels: ["key", "cat", "val"], units: ["", "", ""], metadata: {},
    };
    const started = performance.now();
    const out = unstackWorksheet(long, 0, 1, 2, "mean");
    expect(performance.now() - started).toBeLessThan(5_000);
    // Mean of 0..n-1 — proves the streaming accumulator still aggregates right.
    expect(out.values).toEqual([[(n - 1) / 2]]);
  });

  it("unstack keeps first/last duplicate semantics under the streaming accumulator", () => {
    const long: DataStruct = {
      time: [0, 0, 0],
      values: [[1, 0, 10], [1, 0, 20], [1, 0, 30]],
      labels: ["key", "cat", "val"], units: ["", "", ""], metadata: {},
    };
    expect(unstackWorksheet(long, 0, 1, 2, "first").values).toEqual([[10]]);
    expect(unstackWorksheet(long, 0, 1, 2, "last").values).toEqual([[30]]);
    expect(unstackWorksheet(long, 0, 1, 2, "mean").values).toEqual([[20]]);
  });
});
