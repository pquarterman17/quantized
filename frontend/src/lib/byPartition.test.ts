import { describe, expect, it } from "vitest";

import { byColumnOptions, partitionByColumn } from "./byPartition";
import type { Dataset, DataStruct } from "./types";

// 3-level nominal "grp" (12 rows, 4 per level — nominal inference needs
// >=12 samples, <=8 distinct levels, each level used on average >=3x), a
// continuous "val", and a metadata text-label column covering "grp" so
// level labels resolve through the same text-label path the stat stage
// uses (lib/barlayout.resolveCategoryLabels).
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 12], [0, 14], [0, 16],
    [1, 20], [1, 22], [1, 24], [1, 26],
    [2, 30], [2, 32], [2, 34], [2, 36],
  ],
  labels: ["grp", "val"],
  units: ["", "K"],
  metadata: {
    origin_text_columns: {
      A: ["lo", "lo", "lo", "lo", "mid", "mid", "mid", "mid", "hi", "hi", "hi", "hi"],
    },
  },
};

const ACTIVE: Dataset = { id: "d1", name: "run.dat", data: DATA };

describe("byColumnOptions", () => {
  it("returns only categorical (nominal/ordinal) channels, never the x column", () => {
    const columns = [{ index: -1, label: "T" }, { index: 0, label: "grp" }, { index: 1, label: "val" }];
    expect(byColumnOptions(ACTIVE, columns)).toEqual([{ index: 0, label: "grp" }]);
  });

  it("is empty with no active dataset", () => {
    expect(byColumnOptions(null, [{ index: 0, label: "grp" }])).toEqual([]);
  });
});

describe("partitionByColumn", () => {
  it("partitions rows into one level per distinct value, ascending, labels via text-column resolution", () => {
    const levels = partitionByColumn(DATA, 0);
    expect(levels.map((l) => l.label)).toEqual(["lo", "mid", "hi"]);
    expect(levels.map((l) => l.value)).toEqual([0, 1, 2]);
    expect(levels.map((l) => l.rowIndexes)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
    ]);
  });

  it("every level's sliced DataStruct carries only that level's rows, with labels/units/metadata intact", () => {
    const levels = partitionByColumn(DATA, 0);
    expect(levels[0].data.time).toEqual([0, 1, 2, 3]);
    expect(levels[0].data.values).toEqual([[0, 10], [0, 12], [0, 14], [0, 16]]);
    expect(levels[0].data.labels).toEqual(DATA.labels);
    expect(levels[0].data.units).toEqual(DATA.units);
  });

  it("accounts for every source row exactly once across all levels (no drops, no dupes)", () => {
    const levels = partitionByColumn(DATA, 0);
    const total = levels.reduce((n, l) => n + l.rowIndexes.length, 0);
    expect(total).toBe(DATA.time.length);
    const all = levels.flatMap((l) => l.rowIndexes).sort((a, b) => a - b);
    expect(all).toEqual([...Array(DATA.time.length).keys()]);
  });

  it("drops rows with a non-finite by-value from every level", () => {
    const withNan: DataStruct = {
      ...DATA,
      values: DATA.values.map((row, i) => (i === 0 ? [NaN, row[1]] : row)),
    };
    const levels = partitionByColumn(withNan, 0);
    expect(levels.flatMap((l) => l.rowIndexes)).not.toContain(0);
  });
});
