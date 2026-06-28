import { describe, expect, it } from "vitest";

import type { DataStruct } from "./types";
import {
  alignToUnionX,
  autoSpacing,
  buildWaterfall,
  commonChannels,
  extractSeries,
  waterfallToCSV,
  type WaterfallSeries,
} from "./waterfall";

const ds = (labels: string[], time: number[], values: number[][]): DataStruct => ({
  time,
  values,
  labels,
  units: labels.map(() => ""),
  metadata: {},
});

describe("commonChannels", () => {
  it("returns the intersection in first-dataset order", () => {
    const a = ds(["T", "R", "M"], [1], [[1, 2, 3]]);
    const b = ds(["M", "R", "X"], [1], [[3, 2, 9]]);
    expect(commonChannels([a, b])).toEqual(["R", "M"]);
  });
  it("is empty for no datasets", () => {
    expect(commonChannels([])).toEqual([]);
  });
});

describe("extractSeries", () => {
  it("pulls a channel by label with x = .time and computes the range", () => {
    const d = ds(["T", "R"], [10, 20, 30], [[0, 5], [0, 7], [0, 2]]);
    const s = extractSeries(d, "d1", "scan-1", "R");
    expect(s.x).toEqual([10, 20, 30]);
    expect(s.y).toEqual([5, 7, 2]);
    expect(s.range).toBe(5); // 7 − 2
  });
  it("returns empty y for a missing channel (never throws)", () => {
    const d = ds(["T"], [1, 2], [[1], [2]]);
    expect(extractSeries(d, "d1", "x", "R").y).toEqual([]);
  });
  it("ignores non-finite values in the range", () => {
    const d = ds(["R"], [1, 2, 3], [[NaN], [4], [10]]);
    expect(extractSeries(d, "d", "n", "R").range).toBe(6);
  });
});

describe("autoSpacing", () => {
  it("is 0.8 × median of positive ranges", () => {
    expect(autoSpacing([2, 4, 6])).toBeCloseTo(0.8 * 4);
    expect(autoSpacing([2, 4])).toBeCloseTo(0.8 * 3);
  });
  it("falls back to 1 with no positive range", () => {
    expect(autoSpacing([0, 0])).toBe(1);
    expect(autoSpacing([])).toBe(1);
  });
});

describe("buildWaterfall", () => {
  const series: WaterfallSeries[] = [
    { id: "a", label: "A", x: [1, 2], y: [10, 20], range: 10 },
    { id: "b", label: "B", x: [1, 2], y: [30, 40], range: 10 },
    { id: "c", label: "C", x: [1, 2], y: [50, 60], range: 10 },
  ];

  it("additive: shifts trace k up by k·spacing (1:1 with input order)", () => {
    const t = buildWaterfall(series, { spacing: 100, mode: "add", reverse: false });
    expect(t[0].y).toEqual([10, 20]); // k=0
    expect(t[1].y).toEqual([130, 140]); // k=1 → +100
    expect(t[2].y).toEqual([250, 260]); // k=2 → +200
    expect(t.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("reverse flips the vertical positions (first dataset on top)", () => {
    const t = buildWaterfall(series, { spacing: 100, mode: "add", reverse: true });
    expect(t[0].y).toEqual([210, 220]); // a now at k=2
    expect(t[2].y).toEqual([50, 60]); // c now at k=0
  });

  it("multiplicative: scales trace k by spacingᵏ", () => {
    const t = buildWaterfall(series, { spacing: 2, mode: "mul", reverse: false });
    expect(t[0].y).toEqual([10, 20]); // ×1
    expect(t[1].y).toEqual([60, 80]); // ×2
    expect(t[2].y).toEqual([200, 240]); // ×4
  });

  it("maps non-finite y to null", () => {
    const s: WaterfallSeries[] = [{ id: "a", label: "A", x: [1, 2], y: [NaN, 5], range: 0 }];
    expect(buildWaterfall(s, { spacing: 10, mode: "add", reverse: false })[0].y).toEqual([null, 5]);
  });
});

describe("alignToUnionX", () => {
  it("merges onto the sorted union of x, null where a trace is absent", () => {
    const traces = buildWaterfall(
      [
        { id: "a", label: "A", x: [1, 3], y: [1, 3], range: 2 },
        { id: "b", label: "B", x: [2, 3], y: [2, 9], range: 7 },
      ],
      { spacing: 0, mode: "add", reverse: false },
    );
    const { x, ys } = alignToUnionX(traces);
    expect(x).toEqual([1, 2, 3]);
    expect(ys[0]).toEqual([1, null, 3]);
    expect(ys[1]).toEqual([null, 2, 9]);
  });
});

describe("waterfallToCSV", () => {
  const series: WaterfallSeries[] = [
    { id: "a", label: "A", x: [1, 2], y: [10, 20], range: 10 },
    { id: "b", label: "B", x: [1, 2], y: [30, 40], range: 10 },
  ];
  const opts = { spacing: 100, mode: "add" as const, reverse: false };

  it("emits raw channel values when not baked", () => {
    const csv = waterfallToCSV(series, opts, "R", false);
    const rows = csv.trim().split("\n");
    expect(rows[0]).toBe("A x,A R,B x,B R");
    expect(rows[1]).toBe("1,10,1,30");
    expect(rows[2]).toBe("2,20,2,40");
  });

  it("bakes the offset into the y columns when requested", () => {
    const csv = waterfallToCSV(series, opts, "R", true);
    const rows = csv.trim().split("\n");
    expect(rows[1]).toBe("1,10,1,130"); // B shifted +100
    expect(rows[2]).toBe("2,20,2,140");
  });

  it("blank-fills ragged columns and quotes headers with commas", () => {
    const ragged: WaterfallSeries[] = [
      { id: "a", label: "long, name", x: [1, 2, 3], y: [1, 2, 3], range: 2 },
      { id: "b", label: "B", x: [1], y: [9], range: 0 },
    ];
    const rows = waterfallToCSV(ragged, opts, "R", false).trim().split("\n");
    expect(rows[0]).toBe('"long, name x","long, name R",B x,B R');
    expect(rows[3]).toBe("3,3,,"); // B exhausted → trailing blanks
  });
});
