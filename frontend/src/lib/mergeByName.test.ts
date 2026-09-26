// P2.5 append by column NAME (lib/mergeByName.ts via mergeDatasets'
// `match = "name"`): same-named columns line up whatever their position, a
// column one input lacks is NaN-filled for its rows AND reported by
// analyzeMerge — never dropped silently — and by-position stays the default.

import { describe, expect, it } from "vitest";

import { analyzeMerge } from "./appendWarnings";
import { mergeDatasets } from "./merge";
import { alignColumnsByName } from "./mergeByName";
import type { DataStruct } from "./types";

const a: DataStruct = {
  time: [1, 2],
  values: [[10, 100], [20, 200]],
  labels: ["M", "T"],
  units: ["emu", "K"],
  metadata: { source: "a.dat" },
};
// Same two names in the OTHER order, plus a column `a` does not have.
const b: DataStruct = {
  time: [3],
  values: [[300, 30, 7]],
  labels: ["t", "M ", "H"],
  units: ["K", "emu", "Oe"],
  metadata: {},
};

describe("append by column name", () => {
  it("lines same-named columns up (trimmed, case-insensitive) and NaN-fills a missing one", () => {
    const m = mergeDatasets([a, b], ["a.dat", "b.dat"], "name");
    // a's columns keep their positions; b's new "H" is appended.
    expect(m.labels).toEqual(["M", "T", "H"]);
    expect(m.units).toEqual(["emu", "K", "Oe"]);
    expect(m.time).toEqual([1, 2, 3]);
    expect(m.values[0]).toEqual([10, 100, Number.NaN]);
    expect(m.values[1]).toEqual([20, 200, Number.NaN]);
    expect(m.values[2]).toEqual([30, 300, 7]);
    expect(m.metadata).toMatchObject({ merged_by: "name", merged_count: 2, source: "a.dat" });
  });

  it("reports every missing column — the rows are blank there, never dropped silently", () => {
    const w = analyzeMerge([a, b], ["a.dat", "b.dat"], "name");
    expect(w).toEqual([
      {
        code: "missing-columns",
        text: 'a.dat has no "H" column; its 2 rows are left blank (NaN) there.',
        count: 1,
        columns: ["H"],
      },
    ]);
    // And the input that has every column is not mentioned.
    expect(w.some((x) => x.text.startsWith("b.dat"))).toBe(false);
  });

  it("names every column an input lacks, and still flags a unit mismatch between same-named columns", () => {
    const c: DataStruct = { time: [9], values: [[1]], labels: ["T"], units: ["mK"], metadata: {} };
    const w = analyzeMerge([a, c], ["a.dat", "c.dat"], "name");
    expect(w.map((x) => x.code)).toEqual(["unit-mismatch", "missing-columns"]);
    expect(w[0]).toMatchObject({ confirm: true, columns: ["T"] });
    expect(w[0].text).toContain('"T" is K in a.dat but mK in c.dat');
    expect(w[1].text).toBe('c.dat has no "M" column; its row is left blank (NaN) there.');
    const m = mergeDatasets([a, c], ["a.dat", "c.dat"], "name");
    expect(m.values[2]).toEqual([Number.NaN, 1]);
  });

  it("pairs a repeated name occurrence by occurrence", () => {
    const d1: DataStruct = { time: [0], values: [[1, 2]], labels: ["V", "V"], units: ["", ""], metadata: {} };
    const d2: DataStruct = { time: [0], values: [[3]], labels: ["V"], units: [""], metadata: {} };
    expect(alignColumnsByName([d1, d2]).cols).toEqual([[0, 1], [0, -1]]);
    expect(mergeDatasets([d1, d2], ["d1", "d2"], "name").values[1]).toEqual([3, Number.NaN]);
  });

  it("an unnamed column pairs only with an unnamed column at the same position", () => {
    // u1's unnamed 3rd column must not swallow u2's real "Column 3"; it pairs
    // with u2's unnamed 3rd column instead.
    const u1: DataStruct = { time: [0], values: [[1, 2, 3]], labels: ["M", "x", ""], units: ["", "", ""], metadata: {} };
    const u2: DataStruct = { time: [0], values: [[4, 5, 6]], labels: ["M", "Column 3", ""], units: ["", "", ""], metadata: {} };
    expect(alignColumnsByName([u1, u2])).toMatchObject({
      labels: ["M", "x", "", "Column 3"],
      cols: [[0, 1, 2, -1], [0, -1, 2, 1]],
    });
  });

  it("keeps a categorical column categorical, remapping each input's codes by level text", () => {
    const c1: DataStruct = { time: [0, 1], values: [[0, 5], [1, 6]], labels: ["S", "Y"], units: ["", ""], metadata: {}, cat_levels: { 0: ["x", "y"] } };
    // "S" at position 1 here, with a different level table; no "Y".
    const c2: DataStruct = { time: [2], values: [[9, 0]], labels: ["Z", "S"], units: ["", ""], metadata: {}, cat_levels: { 1: ["y"] } };
    const m = mergeDatasets([c1, c2], ["c1", "c2"], "name");
    expect(m.labels).toEqual(["S", "Y", "Z"]);
    expect(m.cat_levels?.[0]).toEqual(["x", "y"]);
    // c2's "y" (its code 0) lands on the union's code 1.
    expect(m.values.map((r) => r[0])).toEqual([0, 1, 1]);
  });

  it("by position stays the default, and refuses differing column counts", () => {
    expect(() => mergeDatasets([a, b], ["a", "b"])).toThrow(/column-count/);
    expect(analyzeMerge([a, { ...a, labels: ["T", "M"] }], ["a", "b"]).map((w) => w.code)).toEqual(["label-mismatch"]);
  });
});
