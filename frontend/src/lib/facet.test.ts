import { describe, expect, it } from "vitest";

import {
  breakPayloads,
  facetPayloads,
  facetSlices,
  sharedXDomain,
  sharedYDomain,
  suggestBreaks,
  type BreakPanel,
  type FacetPanel,
} from "./facet";
import type { PlotPayload } from "./plotdata";
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

// facetSlices (GUI_INTERACTION #11): the row-slicing primitive facetPayloads
// now builds on. facetPayloads' OWN describe block above is left completely
// unmodified — it must keep passing byte-for-byte as a behavior-unchanged
// regression check on the refactor.
describe("facetSlices", () => {
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

  it("splits into one row-sliced DataStruct per distinct level, ascending", () => {
    const slices = facetSlices(ds, 0);
    expect(slices).toHaveLength(2);
    expect(slices[0].label).toBe("1");
    expect(slices[1].label).toBe("2");
  });

  it("each slice's data contains ONLY rows at that level", () => {
    const slices = facetSlices(ds, 0);
    expect(slices[0].data.time).toEqual([0, 1, 4]);
    expect(slices[0].data.values).toEqual([[1, 10], [1, 20], [1, 50]]);
    expect(slices[1].data.time).toEqual([2, 3, 5]);
    expect(slices[1].data.values).toEqual([[2, 30], [2, 40], [2, 60]]);
  });

  it("uses the resolved category label (text column) when present", () => {
    const withLabels: DataStruct = {
      ...ds,
      metadata: { origin_text_columns: { C: ["North", "North", "South", "South", "North", "South"] } },
    };
    const slices = facetSlices(withLabels, 0);
    expect(slices.map((s) => s.label)).toEqual(["North", "South"]);
  });

  it("returns [] when the facet column has no finite levels", () => {
    const allNaN: DataStruct = { ...ds, values: ds.values.map((r) => [NaN, r[1]]) };
    expect(facetSlices(allNaN, 0)).toEqual([]);
  });

  it("rows with a non-finite facet value belong to no slice", () => {
    const mixed: DataStruct = { ...ds, values: [[1, 10], [NaN, 20], [2, 30]], time: [0, 1, 2] };
    const slices = facetSlices(mixed, 0);
    expect(slices).toHaveLength(2);
    expect(slices.flatMap((s) => s.data.time)).toEqual([0, 2]); // row 1 (NaN) dropped everywhere
  });

  it("supports channel<0 (facet by the x/time column itself)", () => {
    const small: DataStruct = {
      time: [1, 1, 2],
      values: [[10], [20], [30]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const slices = facetSlices(small, -1);
    expect(slices).toHaveLength(2);
    expect(slices[0].data.time).toEqual([1, 1]);
    expect(slices[1].data.time).toEqual([2]);
  });

  it("preserves every other DataStruct field verbatim (labels/units/metadata)", () => {
    const slices = facetSlices(ds, 0);
    expect(slices[0].data.labels).toBe(ds.labels);
    expect(slices[0].data.units).toBe(ds.units);
    expect(slices[0].data.metadata).toBe(ds.metadata);
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

describe("sharedXDomain", () => {
  const panel = (xs: (number | null)[]): FacetPanel => ({
    label: "l",
    payload: {
      data: [xs, xs.map(() => 1)] as PlotPayload["data"],
      series: [{ label: "y", unit: "", axis: 0 }],
      xLabel: "x",
      xUnit: "",
    },
  });

  it("unions the finite x-range across every panel", () => {
    expect(sharedXDomain([panel([0, 1, 2]), panel([5, 10])])).toEqual([0, 10]);
  });

  it("ignores non-finite values within a panel", () => {
    expect(sharedXDomain([panel([NaN, 1, Infinity, 2]), panel([-1, 3])])).toEqual([-1, 3]);
  });

  it("returns null when no panel has any finite x value", () => {
    expect(sharedXDomain([panel([NaN, null]), panel([])])).toBeNull();
  });

  it("returns null for an empty panel set", () => {
    expect(sharedXDomain([])).toBeNull();
  });

  it("handles a single panel (domain = that panel's own range)", () => {
    expect(sharedXDomain([panel([3, 1, 2])])).toEqual([1, 3]);
  });
});

describe("breakPayloads", () => {
  const ds: DataStruct = {
    time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 60, 61, 62, 63],
    values: Array.from({ length: 14 }, (_, i) => [i * 10]),
    labels: ["y"],
    units: [""],
    metadata: {},
  };
  const oneBreak: [number, number][] = [[9, 60]];

  it("splits a single gap into two contiguous panels", () => {
    const panels = breakPayloads(ds, null, [0], oneBreak);
    expect(panels).toHaveLength(2);
    expect(panels[0].payload.data[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(panels[1].payload.data[0]).toEqual([60, 61, 62, 63]);
  });

  it("each panel's xRange is its own finite x extent, not the full data span", () => {
    const panels = breakPayloads(ds, null, [0], oneBreak);
    expect(panels[0].xRange).toEqual([0, 9]);
    expect(panels[1].xRange).toEqual([60, 63]);
  });

  it("handles multiple breaks (N breaks -> N+1 panels)", () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 20, 21, 22, 100, 101, 102],
      values: Array.from({ length: 9 }, (_, i) => [i]),
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const breaks: [number, number][] = [
      [2, 20],
      [22, 100],
    ];
    const panels = breakPayloads(multi, null, [0], breaks);
    expect(panels).toHaveLength(3);
    expect(panels[0].payload.data[0]).toEqual([0, 1, 2]);
    expect(panels[1].payload.data[0]).toEqual([20, 21, 22]);
    expect(panels[2].payload.data[0]).toEqual([100, 101, 102]);
  });

  it("sorts unsorted breaks before segmenting", () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 20, 21, 22, 100, 101, 102],
      values: Array.from({ length: 9 }, (_, i) => [i]),
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const reversedBreaks: [number, number][] = [
      [22, 100],
      [2, 20],
    ];
    const panels = breakPayloads(multi, null, [0], reversedBreaks);
    expect(panels).toHaveLength(3);
    expect(panels[0].payload.data[0]).toEqual([0, 1, 2]);
  });

  it("drops a segment with no finite rows rather than rendering an empty panel", () => {
    // Break carves out a segment [9, 60] with no data on either side of a third gap.
    const sparse: DataStruct = {
      time: [0, 1, 100, 101],
      values: [[0], [1], [100], [101]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const breaks: [number, number][] = [
      [1, 50],
      [50, 100],
    ];
    const panels = breakPayloads(sparse, null, [0], breaks);
    // middle segment [50,50] has no rows -> dropped, leaving 2 panels.
    expect(panels).toHaveLength(2);
  });

  it("returns [] when breaks is empty", () => {
    expect(breakPayloads(ds, null, [0], [])).toEqual([]);
  });
});

describe("sharedYDomain", () => {
  const panel = (ys: (number | null)[]): BreakPanel => ({
    xRange: [0, ys.length - 1],
    payload: {
      data: [ys.map((_, i) => i), ys] as PlotPayload["data"],
      series: [{ label: "y", unit: "", axis: 0 }],
      xLabel: "x",
      xUnit: "",
    },
  });

  it("unions the finite y-range across every panel's series", () => {
    expect(sharedYDomain([panel([0, 5]), panel([10, -3])])).toEqual([-3, 10]);
  });

  it("ignores non-finite values", () => {
    expect(sharedYDomain([panel([NaN, 1, Infinity]), panel([-2, 3])])).toEqual([-2, 3]);
  });

  it("returns null when no panel has any finite y value", () => {
    expect(sharedYDomain([panel([NaN, null]), panel([])])).toBeNull();
  });

  it("returns null for an empty panel set", () => {
    expect(sharedYDomain([])).toBeNull();
  });

  it("covers multiple series within one panel", () => {
    const twoSeries: BreakPanel = {
      xRange: [0, 1],
      payload: {
        data: [
          [0, 1],
          [5, 6],
          [-10, 2],
        ] as PlotPayload["data"],
        series: [
          { label: "a", unit: "", axis: 0 },
          { label: "b", unit: "", axis: 0 },
        ],
        xLabel: "x",
        xUnit: "",
      },
    };
    expect(sharedYDomain([twoSeries])).toEqual([-10, 6]);
  });
});
