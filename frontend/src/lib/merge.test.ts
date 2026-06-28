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
