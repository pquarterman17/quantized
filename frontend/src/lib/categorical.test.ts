import { describe, expect, it } from "vitest";

import { categoricalLevels, isCategoricalChannel, levelLabel } from "./categorical";
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
