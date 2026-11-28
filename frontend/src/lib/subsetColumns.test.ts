import { describe, expect, it } from "vitest";

import { dropChannels, parseSubsetDestination, subsetSeries } from "./subsetColumns";
import type { DataStruct } from "./types";

const data = (extra: Partial<DataStruct> = {}): DataStruct => ({
  time: [0, 1, 2], values: [[1, 10, 100], [2, Number.NaN, 200], [3, 30, 300]], labels: ["a", "b", "c"], units: ["", "K", "T"], metadata: {}, ...extra,
});

describe("subsetSeries", () => {
  it("counts, per series, the region's rows that hold a finite value", () => {
    expect(subsetSeries(data(), [0, 1], [0, 1, 2]).map((s) => [s.label, s.rows])).toEqual([["a", 3], ["b", 2]]);
    expect(subsetSeries(data(), [1], [1])[0].rows).toBe(0);
  });
});

describe("dropChannels", () => {
  it("drops nothing without a request, and renumbers every channel-indexed field with one", () => {
    const d = data({ cat_levels: { 0: ["x", "y"], 2: ["p"] }, level_order: { 2: [0] } });
    expect(dropChannels(d, new Set())).toEqual({ data: d });
    const out = dropChannels(d, new Set([1]));
    expect("data" in out && out.data).toMatchObject({
      values: [[1, 100], [2, 200], [3, 300]], labels: ["a", "c"], units: ["", "T"], cat_levels: { 0: ["x", "y"], 1: ["p"] }, level_order: { 1: [0] },
    });
  });

  it("refuses when per-column metadata would be left describing other columns", () => {
    const out = dropChannels(data({ metadata: { all_column_names: ["a", "b", "c"] } }), new Set([0]));
    expect(out).toEqual({ refusal: expect.stringContaining("all_column_names") });
  });
});

describe("parseSubsetDestination", () => {
  it("names the new workbook, an existing one, and fails closed to the source's for anything else", () => {
    expect(parseSubsetDestination("new", [])).toEqual({ kind: "new" });
    expect(parseSubsetDestination("wb:w2", ["w1", "w2"])).toEqual({ kind: "workbook", id: "w2" });
    expect(parseSubsetDestination("wb:gone", ["w1"])).toEqual({ kind: "source" });
    expect(parseSubsetDestination("???", ["w1"])).toEqual({ kind: "source" });
  });
});
