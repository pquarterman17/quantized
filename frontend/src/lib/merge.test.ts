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

// P1.4 review P2-1: merge drops levels unless every merged dataset agrees.
// RULING: per-channel, carry the level table iff EVERY merged dataset has an
// IDENTICAL (same order) level table for that channel; on any mismatch, drop
// that channel's levels (the codes would be incoherent -- e.g. code 0 means
// "North" in one dataset and "East" in the other). Real conflict-resolution
// (remapping codes to a union table) is booked under P1.5.
describe("mergeDatasets — cat_levels (P1.4 review P2-1)", () => {
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

  it("drops that channel's levels when datasets disagree on the level strings", () => {
    const m = mergeDatasets([catA, catBDiffering], ["a", "b"]);
    expect(m.cat_levels?.[1]).toBeUndefined();
  });

  it("drops that channel's levels when one dataset has no level table for it at all", () => {
    const m = mergeDatasets([catA, catBMissing], ["a", "b"]);
    expect(m.cat_levels?.[1]).toBeUndefined();
  });

  it("drops that channel's levels when the level ORDER differs (same strings, different order)", () => {
    const m = mergeDatasets([catA, catBReordered], ["a", "b"]);
    expect(m.cat_levels?.[1]).toBeUndefined();
  });

  it("omits cat_levels entirely when no channel survives agreement (additive, not a stray empty object)", () => {
    const m = mergeDatasets([catA, catBDiffering], ["a", "b"]);
    expect("cat_levels" in m).toBe(false);
  });

  it("carries only the AGREEING channel forward when a second categorical channel disagrees", () => {
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
      values: [[1, 0]],
      labels: ["Region", "Lot"],
      units: ["", ""],
      metadata: {},
      cat_levels: { 0: ["North", "South"], 1: ["L2", "L1"] }, // channel 1 disagrees (order)
    };
    const m = mergeDatasets([wideA, wideB], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 0: ["North", "South"] });
  });

  it("plain numeric datasets (no cat_levels anywhere) merge with no cat_levels key", () => {
    const m = mergeDatasets([a, b], ["a", "b"]);
    expect("cat_levels" in m).toBe(false);
  });
});
