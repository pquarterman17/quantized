import { describe, expect, it } from "vitest";

import {
  categoricalLevels,
  categoryLevels,
  isCategoricalChannel,
  levelCountOf,
  levelLabel,
  levelsOf,
} from "./categorical";
import type { DataStruct } from "./types";

const catDs: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [10, 0],
    [20, 1],
    [30, NaN],
    [40, 0],
  ],
  labels: ["Moment", "Region"],
  units: ["emu", ""],
  metadata: {},
  cat_levels: { 1: ["North", "South"] },
};

const plainDs: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["a"],
  units: [""],
  metadata: {},
};

describe("isCategoricalChannel", () => {
  it("true for a channel with a level table", () => {
    expect(isCategoricalChannel(catDs, 1)).toBe(true);
  });

  it("false for a numeric channel on the same dataset", () => {
    expect(isCategoricalChannel(catDs, 0)).toBe(false);
  });

  it("false when the dataset carries no cat_levels at all", () => {
    expect(isCategoricalChannel(plainDs, 0)).toBe(false);
  });
});

describe("categoricalLevels", () => {
  it("returns the ordered level strings", () => {
    expect(categoricalLevels(catDs, 1)).toEqual(["North", "South"]);
  });

  it("returns null for a non-categorical channel", () => {
    expect(categoricalLevels(catDs, 0)).toBeNull();
  });
});

describe("levelLabel", () => {
  it("resolves a valid code to its level string", () => {
    expect(levelLabel(catDs, 1, 0)).toBe("North");
    expect(levelLabel(catDs, 1, 1)).toBe("South");
  });

  it("never throws — NaN, out-of-range, non-integer, and non-categorical all return null", () => {
    expect(levelLabel(catDs, 1, NaN)).toBeNull();
    expect(levelLabel(catDs, 1, 99)).toBeNull();
    expect(levelLabel(catDs, 1, 0.5)).toBeNull();
    expect(levelLabel(catDs, 0, 0)).toBeNull();
  });
});

// P1.4 review P2-3/P3-1: the accessors are "the ONLY sanctioned read path"
// (module doc above), so they must degrade safely on a structurally
// corrupted `cat_levels` even when called DIRECTLY — not only when the data
// arrived through `lib/workspace.ts`'s .dwk load (which has its OWN
// sanitization, `workspace.test.ts`'s corruption tests). A live import
// response, or any other ingestion path that never touches workspace.ts,
// must not produce string-indexed garbage either.
describe("corrupted cat_levels shapes degrade, never throw, never produce garbage", () => {
  // The reviewer's exact probe shape: a level "list" that is a bare string.
  // Before the fix, `categoricalLevels` returned "AB" as if it were
  // `["A", "B"]` (JS lets you index a string), and `levelLabel` then
  // silently returned the CHARACTERS "A"/"B" — plausible-looking, WRONG.
  const corrupted: DataStruct = { ...plainDs, cat_levels: { 0: "AB" as unknown as string[] } };

  it("isCategoricalChannel is false for a non-array level list", () => {
    expect(isCategoricalChannel(corrupted, 0)).toBe(false);
  });

  it("categoricalLevels is null for a non-array level list", () => {
    expect(categoricalLevels(corrupted, 0)).toBeNull();
  });

  it("levelLabel never returns a character sliced out of a corrupted string", () => {
    expect(levelLabel(corrupted, 0, 0)).toBeNull(); // NOT "A"
    expect(levelLabel(corrupted, 0, 1)).toBeNull(); // NOT "B"
  });

  it("a level list with a non-string element is rejected", () => {
    const ds: DataStruct = { ...plainDs, cat_levels: { 0: ["A", 2, "C"] as unknown as string[] } };
    expect(isCategoricalChannel(ds, 0)).toBe(false);
    expect(categoricalLevels(ds, 0)).toBeNull();
  });

  it("an empty level list is rejected (cat_levels' own non-empty-tuple contract)", () => {
    const ds: DataStruct = { ...plainDs, cat_levels: { 0: [] } };
    expect(isCategoricalChannel(ds, 0)).toBe(false);
  });
});

// Group O-1: the level primitives the five former private copies now share.
// These pin the CONTRACT every order-sensitive surface depends on, so J1's
// user-settable ordering has one place to change and one place to re-verify.
describe("category level primitives (Group O-1)", () => {
  it("returns distinct finite values, ascending, regardless of input order", () => {
    expect(levelsOf([3, 1, 2, 1, 3])).toEqual([1, 2, 3]);
    expect(levelsOf([2, 2, 2])).toEqual([2]);
    expect(levelsOf([])).toEqual([]);
  });

  it("drops every non-finite entry rather than making it a level", () => {
    // NaN is a MISSING category; null/undefined arrive from an already-nulled
    // plot payload (`applyGroupSplit`'s input). None becomes a level, and none
    // disqualifies the rest.
    expect(levelsOf([1, Number.NaN, 2, null, undefined, Infinity, -Infinity, 3])).toEqual([1, 2, 3]);
    expect(levelsOf([Number.NaN, null, undefined])).toEqual([]);
  });

  it("collapses -0 with 0, matching the Map keying that groups rows by level", () => {
    // Both a Set and a Map use SameValueZero, so `lib/datasetsplit.ts`'s
    // exact-value grouping and this accessor agree on what ONE level is. If
    // they disagreed, a split would produce a group with no level or vice versa.
    expect(levelsOf([-0, 0, 1])).toEqual([0, 1]);
    expect(Object.is(levelsOf([-0])[0], 0)).toBe(true);
  });

  it("sorts NUMERICALLY, not lexicographically", () => {
    // The default Array#sort would give [10, 2, 9] here — the classic bug this
    // shape's explicit comparator exists to avoid.
    expect(levelsOf([9, 10, 2])).toEqual([2, 9, 10]);
    expect(levelsOf([-5, 100, -20])).toEqual([-20, -5, 100]);
  });

  it("levelCountOf always equals levelsOf(...).length", () => {
    // Two functions, one answer: the count path exists so a caller that needs
    // only a size does not materialize and sort a list, and this is what keeps
    // it honest.
    for (const input of [
      [],
      [1],
      [2, 2, 2],
      [3, 1, 2, 1],
      [1, Number.NaN, null, 2, undefined],
      [-0, 0],
      [Number.NaN],
      [9, 10, 2, 10],
    ]) {
      expect(levelCountOf(input), JSON.stringify(input)).toBe(levelsOf(input).length);
    }
  });

  it("categoryLevels reads a value channel, and -1 as the x/time column", () => {
    const ds: DataStruct = {
      time: [30, 10, 20, 10],
      values: [[2], [1], [3], [1]],
      labels: ["c"],
      units: [""],
      metadata: {},
    };
    expect(categoryLevels(ds, 0)).toEqual([1, 2, 3]);
    // The -1 convention is shared with `ColumnFilter.col`; barlayout's original
    // `categoryLevels` had it, and dropping it in the move would have silently
    // changed what a categorical x axis renders.
    expect(categoryLevels(ds, -1)).toEqual([10, 20, 30]);
  });

  it("categoryLevels is levelsOf over the column, for both conventions", () => {
    const ds: DataStruct = {
      time: [5, 5, Number.NaN],
      values: [[1], [Number.NaN], [1]],
      labels: ["c"],
      units: [""],
      metadata: {},
    };
    expect(categoryLevels(ds, 0)).toEqual(levelsOf(ds.values.map((r) => r[0])));
    expect(categoryLevels(ds, -1)).toEqual(levelsOf(ds.time));
  });
});
