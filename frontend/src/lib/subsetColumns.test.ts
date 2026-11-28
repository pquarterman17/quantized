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

  it("renumbers a plain CSV's column roster, units list, label rows and cell notes", () => {
    const meta = {
      x_column_name: "t", all_column_names: ["t", "a", "txt", "b (K)", "c"], all_column_units: ["", "", "", "K", "T"],
      label_rows: [{ index: 0, role: "header", x: "t", cells: ["a", "b", "c"] }],
      __quantized_cell_notes: { "-1": { 0: "x" }, 0: { 0: "on a" }, 1: { 1: "on b" }, 2: { 2: "on c" } },
    };
    const out = dropChannels(data({ metadata: meta }), new Set([1]));
    const m = "data" in out ? out.data.metadata : {};
    expect(m["all_column_names"]).toEqual(["t", "a", "txt", "c"]);
    expect(m["all_column_units"]).toEqual(["", "", "", "T"]);
    expect(m["label_rows"]).toEqual([{ index: 0, role: "header", x: "t", cells: ["a", "c"] }]);
    expect(m["__quantized_cell_notes"]).toEqual({ "-1": { 0: "x" }, 0: { 0: "on a" }, 1: { 2: "on c" } });
  });

  it("resolves a repeated header left to right", () => {
    const d = data({ labels: ["v", "v", "w"], metadata: { all_column_names: ["x", "v", "v", "w"] } });
    const out = dropChannels(d, new Set([0]));
    expect("data" in out && out.data.metadata["all_column_names"]).toEqual(["x", "v", "w"]);
  });

  it("refuses what it cannot renumber: a parser's y / error columns, a channel missing from the roster, a ragged list", () => {
    expect(dropChannels(data({ metadata: { error_roles: [] } }), new Set([0]))).toEqual({ refusal: expect.stringContaining("error_roles") });
    expect(dropChannels(data({ metadata: { y_column_indices: [1] } }), new Set([0]))).toEqual({ refusal: expect.stringContaining("y_column_indices") });
    expect(dropChannels(data({ metadata: { all_column_names: ["a", "c"] } }), new Set([1]))).toEqual({ refusal: expect.stringContaining("does not line up") });
    expect(dropChannels(data({ metadata: { label_rows: [{ cells: ["a"] }] } }), new Set([1]))).toEqual({ refusal: expect.stringContaining("does not line up") });
    expect(dropChannels(data({ metadata: { all_column_names: ["a", "b", "c"], all_column_units: [""] } }), new Set([1]))).toEqual({ refusal: expect.stringContaining("does not line up") });
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
