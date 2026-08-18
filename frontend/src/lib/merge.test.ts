import { describe, expect, it } from "vitest";

import { mergeDatasets } from "./merge";
import type { DataStruct } from "./types";

const a: DataStruct = {
  time: [1, 2],
  values: [[10], [20]],
  labels: ["M"],
  units: ["emu"],
  metadata: { source: "a.dat" },
};
const b: DataStruct = {
  time: [3, 4],
  values: [[30], [40]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
};

describe("mergeDatasets", () => {
  it("concatenates rows in input order, keeping the first's labels/units", () => {
    const m = mergeDatasets([a, b], ["a.dat", "b.dat"]);
    expect(m.time).toEqual([1, 2, 3, 4]);
    expect(m.values).toEqual([[10], [20], [30], [40]]);
    expect(m.labels).toEqual(["M"]);
    expect(m.units).toEqual(["emu"]);
    expect(m.metadata.merged_from).toBe("a.dat + b.dat");
    expect(m.metadata.merged_count).toBe(2);
  });

  it("does not alias source rows", () => {
    const m = mergeDatasets([a, b], ["a", "b"]);
    m.values[0][0] = 999;
    expect(a.values[0][0]).toBe(10); // source untouched
  });

  it("throws on fewer than two datasets", () => {
    expect(() => mergeDatasets([a], ["a"])).toThrow(/at least 2/);
  });

  it("throws on a column-count mismatch", () => {
    const wide: DataStruct = { ...a, labels: ["M", "T"], units: ["emu", "K"], values: [[1, 2], [3, 4]] };
    expect(() => mergeDatasets([a, wide], ["a", "wide"])).toThrow(/column-count/);
  });
});

// P1.4 review P2-1's placeholder ("carry the level table iff every merged
// dataset has an IDENTICAL, same-order table; on any mismatch drop that
// channel entirely") is superseded by P1.5's real conflict resolution below:
// a channel whose datasets ALL carry SOME table for it (possibly differing)
// merges onto a coherent UNION table, remapping every dataset's own codes
// losslessly (lib/merge.ts's `planChannel`/`remapFor`). The one remaining
// drop case is a channel with NO table at all on at least one dataset --
// there is nothing to remap FROM (its raw values were never codes into
// anything), so it still drops, unchanged from the P1.4 ruling.
describe("mergeDatasets — cat_levels (P1.5 real conflict resolution)", () => {
  const catA: DataStruct = {
    time: [1, 2],
    values: [[10, 0], [20, 1]],
    labels: ["M", "Region"],
    units: ["emu", ""],
    metadata: {},
    cat_levels: { 1: ["North", "South"] },
  };
  const catBIdentical: DataStruct = {
    time: [3, 4],
    values: [[30, 1], [40, 0]],
    labels: ["M", "Region"],
    units: ["emu", ""],
    metadata: {},
    cat_levels: { 1: ["North", "South"] },
  };
  const catBDiffering: DataStruct = {
    ...catBIdentical,
    cat_levels: { 1: ["East", "West"] },
  };
  const catBMissing: DataStruct = {
    ...catBIdentical,
    cat_levels: undefined,
  };
  const catBReordered: DataStruct = {
    ...catBIdentical,
    cat_levels: { 1: ["South", "North"] }, // same strings, different ORDER -- still a mismatch
  };

  it("carries the level table forward when every dataset agrees (identical, same order)", () => {
    const m = mergeDatasets([catA, catBIdentical], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 1: ["North", "South"] });
  });

  it("remaps codes onto a union table when datasets disagree on the level strings", () => {
    // catA: North/South (codes 0/1, rows [0,1]). catBDiffering: East/West of
    // its OWN (codes 1/0 = West/East, rows [1,0]). Union = catA's own order
    // first, then catB's genuinely NEW strings appended: [North,South,East,West].
    // catA needs no remap (its table already IS the union's prefix); catB's
    // West(1)->3, East(0)->2.
    const m = mergeDatasets([catA, catBDiffering], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 1: ["North", "South", "East", "West"] });
    expect(m.values.map((row) => row[1])).toEqual([0, 1, 3, 2]);
  });

  it("drops that channel's levels when one dataset has no level table for it at all", () => {
    // The one case that still drops: catBMissing's raw values were never
    // codes into anything, so there is nothing to remap them FROM.
    const m = mergeDatasets([catA, catBMissing], ["a", "b"]);
    expect(m.cat_levels?.[1]).toBeUndefined();
  });

  it("remaps a reordered-but-same-strings table onto the canonical (no-new-strings) union", () => {
    // catBReordered has NO string catA lacks, so the union collapses back to
    // catA's own table -- catB's codes get canonically relabeled onto it
    // (North/South swapped -> remapped back to catA's own order).
    const m = mergeDatasets([catA, catBReordered], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 1: ["North", "South"] });
    expect(m.values.map((row) => row[1])).toEqual([0, 1, 0, 1]);
  });

  it("merges multiple categorical channels independently -- one agrees, one needs a remap", () => {
    const wideA: DataStruct = {
      time: [1],
      values: [[0, 0]],
      labels: ["Region", "Lot"],
      units: ["", ""],
      metadata: {},
      cat_levels: { 0: ["North", "South"], 1: ["L1", "L2"] },
    };
    const wideB: DataStruct = {
      time: [2],
      values: [[1, 1]], // Region=South(1); Lot=L1(1) under wideB's OWN reordered table
      labels: ["Region", "Lot"],
      units: ["", ""],
      metadata: {},
      cat_levels: { 0: ["North", "South"], 1: ["L2", "L1"] }, // channel 1 disagrees (order)
    };
    const m = mergeDatasets([wideA, wideB], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 0: ["North", "South"], 1: ["L1", "L2"] });
    // channel 0 (agrees) unchanged: [0, 1]; channel 1 (remapped) L1(wideB code
    // 1) -> canonical index 0: [0, 0].
    expect(m.values).toEqual([[0, 0], [1, 0]]);
  });

  it("plain numeric datasets (no cat_levels anywhere) merge with no cat_levels key", () => {
    const m = mergeDatasets([a, b], ["a", "b"]);
    expect("cat_levels" in m).toBe(false);
  });
});
