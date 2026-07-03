import { describe, expect, it } from "vitest";

import {
  activeRowIndices,
  excludedSet,
  isRowExcluded,
  pruneExcluded,
  sanitizeExcluded,
  toggleExcluded,
} from "./rowstate";
import type { DataStruct } from "./types";

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
