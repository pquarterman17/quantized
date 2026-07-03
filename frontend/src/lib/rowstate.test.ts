import { describe, expect, it } from "vitest";

import {
  activeRowIndices,
  analysisData,
  droppedRows,
  excludedSet,
  expandToFull,
  isRowExcluded,
  pruneExcluded,
  sanitizeExcluded,
  toggleExcluded,
} from "./rowstate";
import type { Dataset, DataStruct } from "./types";

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [10, 100],
    [20, 200],
    [30, 300],
    [40, 400],
  ],
  labels: ["A", "B"],
  units: ["emu", "Oe"],
  metadata: { source: "test" },
};

describe("excludedSet / isRowExcluded", () => {
  it("reads the dataset's exclusion list as a Set (missing = empty)", () => {
    expect(excludedSet({ excludedRows: [1, 3] })).toEqual(new Set([1, 3]));
    expect(excludedSet({})).toEqual(new Set());
    expect(excludedSet(null)).toEqual(new Set());
  });

  it("reports membership", () => {
    expect(isRowExcluded({ excludedRows: [2] }, 2)).toBe(true);
    expect(isRowExcluded({ excludedRows: [2] }, 1)).toBe(false);
    expect(isRowExcluded(undefined, 0)).toBe(false);
  });
});

describe("toggleExcluded", () => {
  it("adds a missing row and keeps the list sorted", () => {
    expect(toggleExcluded([3, 0], 1)).toEqual([0, 1, 3]);
  });

  it("removes a present row", () => {
    expect(toggleExcluded([0, 1, 3], 1)).toEqual([0, 3]);
  });

  it("treats undefined as empty and de-dupes", () => {
    expect(toggleExcluded(undefined, 2)).toEqual([2]);
    // a duplicate in the input collapses (Set semantics)
    expect(toggleExcluded([2, 2], 5)).toEqual([2, 5]);
  });

  it("does not mutate its input", () => {
    const input = [1, 2];
    toggleExcluded(input, 3);
    expect(input).toEqual([1, 2]);
  });
});

describe("activeRowIndices", () => {
  it("returns the complement of the excluded set, in order", () => {
    expect(activeRowIndices(4, [1, 3])).toEqual([0, 2]);
    expect(activeRowIndices(4, new Set([0]))).toEqual([1, 2, 3]);
    expect(activeRowIndices(3, [])).toEqual([0, 1, 2]);
  });
});

describe("pruneExcluded", () => {
  it("removes excluded rows from time + values (labels/units/metadata intact)", () => {
    const pruned = pruneExcluded(DATA, [1, 3]);
    expect(pruned.time).toEqual([0, 2]);
    expect(pruned.values).toEqual([
      [10, 100],
      [30, 300],
    ]);
    expect(pruned.labels).toBe(DATA.labels);
    expect(pruned.units).toBe(DATA.units);
    expect(pruned.metadata).toBe(DATA.metadata);
  });

  it("returns the SAME object when nothing is excluded (identity fast-path)", () => {
    expect(pruneExcluded(DATA, [])).toBe(DATA);
    expect(pruneExcluded(DATA, new Set())).toBe(DATA);
  });

  it("does not mutate the source", () => {
    pruneExcluded(DATA, [0]);
    expect(DATA.time).toEqual([0, 1, 2, 3]);
  });
});

describe("droppedRows (exclusion ∪ filter)", () => {
  const mk = (over: Partial<Dataset>): Dataset => ({ id: "d", name: "d", data: DATA, ...over });

  it("is empty with neither exclusion nor filter", () => {
    expect(droppedRows(mk({})).size).toBe(0);
    expect(droppedRows(null).size).toBe(0);
  });

  it("returns exclusions alone, filter alone, or their union", () => {
    expect([...droppedRows(mk({ excludedRows: [1] }))]).toEqual([1]);
    // channel 0 = [10,20,30,40]; keep ≥30 → rows 0,1 fail
    expect([...droppedRows(mk({ filter: [{ col: 0, kind: "range", min: 30 }] }))].sort()).toEqual([0, 1]);
    const both = droppedRows(mk({ excludedRows: [3], filter: [{ col: 0, kind: "range", min: 30 }] }));
    expect([...both].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });
});

describe("expandToFull", () => {
  it("scatters pruned values back to their kept indices, null elsewhere", () => {
    // kept rows 0 and 2 of a 4-row dataset
    expect(expandToFull([11, 33], [0, 2], 4)).toEqual([11, null, 33, null]);
  });

  it("is identity-shaped when all rows are kept", () => {
    expect(expandToFull([1, 2, 3], [0, 1, 2], 3)).toEqual([1, 2, 3]);
  });

  it("stops at the shorter of pruned/kept", () => {
    expect(expandToFull([9], [1, 3], 4)).toEqual([null, 9, null, null]);
  });
});

describe("analysisData (exclusion + filter chokepoint)", () => {
  const mk = (over: Partial<Dataset>): Dataset => ({ id: "d", name: "d", data: DATA, ...over });

  it("returns the SAME data when neither exclusion nor filter is active", () => {
    expect(analysisData(mk({}))!).toBe(DATA);
    expect(analysisData(null)).toBeNull();
  });

  it("prunes manually-excluded rows (#50)", () => {
    const out = analysisData(mk({ excludedRows: [0, 2] }))!;
    expect(out.time).toEqual([1, 3]);
  });

  it("prunes filter-failed rows (#53)", () => {
    // keep rows with channel-0 value ≥ 30 → rows 2, 3
    const out = analysisData(mk({ filter: [{ col: 0, kind: "range", min: 30 }] }))!;
    expect(out.time).toEqual([2, 3]);
  });

  it("prunes the UNION of exclusions and the filter", () => {
    const out = analysisData(
      mk({ excludedRows: [3], filter: [{ col: 0, kind: "range", min: 30 }] }),
    )!;
    // filter keeps rows 2,3 (value ≥30); exclusion drops 3 → only row 2 remains
    expect(out.time).toEqual([2]);
  });
});

describe("sanitizeExcluded", () => {
  it("keeps only in-range integer indices, sorted + unique", () => {
    expect(sanitizeExcluded([3, 1, 1, 0], 4)).toEqual([0, 1, 3]);
  });

  it("drops out-of-range, negative, non-integer, and non-number entries", () => {
    expect(sanitizeExcluded([5, -1, 1.5, "2", null, 2], 4)).toEqual([2]);
  });

  it("returns [] for a non-array or an all-invalid list", () => {
    expect(sanitizeExcluded("nope", 4)).toEqual([]);
    expect(sanitizeExcluded(undefined, 4)).toEqual([]);
    expect(sanitizeExcluded([10, 11], 4)).toEqual([]);
  });
});
