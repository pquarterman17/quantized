import { describe, expect, it } from "vitest";

import { facetPayloads, suggestBreaks } from "./facet";
import type { DataStruct } from "./types";

describe("facetPayloads", () => {
  const ds: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [
      [1, 10],
      [1, 20],
      [2, 30],
      [2, 40],
      [1, 50],
      [2, 60],
    ],
    labels: ["grp", "y"],
    units: ["", ""],
    metadata: {},
  };

  it("splits into one panel per distinct facet level, ascending", () => {
    const panels = facetPayloads(ds, 0, null, [1]);
    expect(panels).toHaveLength(2);
    expect(panels[0].label).toBe("1");
    expect(panels[1].label).toBe("2");
  });

  it("each panel's payload contains ONLY rows at that level", () => {
    const panels = facetPayloads(ds, 0, null, [1]);
    // level 1: rows 0,1,4 -> time [0,1,4], y [10,20,50]
    expect(panels[0].payload.data[0]).toEqual([0, 1, 4]);
    expect(panels[0].payload.data[1]).toEqual([10, 20, 50]);
    // level 2: rows 2,3,5 -> time [2,3,5], y [30,40,60]
    expect(panels[1].payload.data[0]).toEqual([2, 3, 5]);
    expect(panels[1].payload.data[1]).toEqual([30, 40, 60]);
  });

  it("uses the resolved category label (text column) when present", () => {
    const withLabels: DataStruct = {
      ...ds,
      metadata: { origin_text_columns: { C: ["North", "North", "South", "South", "North", "South"] } },
    };
    const panels = facetPayloads(withLabels, 0, null, [1]);
    expect(panels.map((p) => p.label)).toEqual(["North", "South"]);
  });

  it("returns [] when the facet column has no finite levels", () => {
    const allNaN: DataStruct = { ...ds, values: ds.values.map((r) => [NaN, r[1]]) };
    expect(facetPayloads(allNaN, 0, null, [1])).toEqual([]);
  });

  it("supports channel<0 (facet by the x/time column itself)", () => {
    const small: DataStruct = {
      time: [1, 1, 2],
      values: [[10], [20], [30]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const panels = facetPayloads(small, -1, null, [0]);
    expect(panels).toHaveLength(2);
    expect(panels[0].payload.data[1]).toEqual([10, 20]);
    expect(panels[1].payload.data[1]).toEqual([30]);
  });
});

describe("suggestBreaks", () => {
  it("detects a single large gap relative to the typical spacing", () => {
    // Typical spacing 1 throughout; one gap of 51 between 9 and 60.
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 60, 61, 62, 63];
    const breaks = suggestBreaks(xs);
    expect(breaks).toEqual([[9, 60]]);
  });

  it("returns [] for evenly-spaced data (no gap stands out)", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    expect(suggestBreaks(xs)).toEqual([]);
  });

  it("returns [] with fewer than 3 finite points", () => {
    expect(suggestBreaks([1, 2])).toEqual([]);
    expect(suggestBreaks([])).toEqual([]);
  });

  it("ignores non-finite values and works on unsorted input", () => {
    const xs = [63, NaN, 0, 62, 9, 8, 7, 6, 5, 4, 3, 2, 1, 61, 60, Infinity];
    const breaks = suggestBreaks(xs);
    expect(breaks).toEqual([[9, 60]]);
  });

  it("detects multiple qualifying gaps", () => {
    const xs = [0, 1, 2, 20, 21, 22, 100, 101, 102];
    const breaks = suggestBreaks(xs, 3);
    expect(breaks).toEqual([
      [2, 20],
      [22, 100],
    ]);
  });
});
