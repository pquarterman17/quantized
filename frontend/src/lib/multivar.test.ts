import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import {
  correlationToTSV,
  defaultContinuousColumns,
  downsampleIndices,
  listwiseComplete,
  miniHistogram,
  multivarColumns,
  multivarColumnValues,
  transposeRows,
} from "./multivar";

function ds(overrides: Partial<Dataset["data"]> = {}, channelTypes?: Dataset["channelTypes"]): Dataset {
  return {
    id: "d1",
    name: "run.dat",
    data: {
      time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      values: Array.from({ length: 12 }, (_, i) => [i, i * 2, (i % 3) + 1]),
      labels: ["a", "b", "level"],
      units: ["", "", ""],
      metadata: { x_column_name: "T" },
      ...overrides,
    },
    channelTypes,
  };
}

describe("multivarColumns", () => {
  it("returns null for no dataset", () => {
    expect(multivarColumns(null)).toEqual([]);
  });
  it("includes x (-1) plus every channel", () => {
    const cols = multivarColumns(ds());
    expect(cols).toEqual([
      { index: -1, label: "T" },
      { index: 0, label: "a" },
      { index: 1, label: "b" },
      { index: 2, label: "level" },
    ]);
  });
});

describe("defaultContinuousColumns", () => {
  it("picks channels that read as continuous, excluding x", () => {
    // "level" cycles 1,2,3,1,2,3,... — few distinct values repeated -> nominal.
    expect(defaultContinuousColumns(ds())).toEqual([0, 1]);
  });
  it("falls back to every channel when none read as continuous", () => {
    const allNominal = ds({}, { 0: "nominal", 1: "nominal", 2: "nominal" });
    expect(defaultContinuousColumns(allNominal)).toEqual([0, 1, 2]);
  });
  it("empty for no dataset", () => {
    expect(defaultContinuousColumns(null)).toEqual([]);
  });
});

describe("multivarColumnValues", () => {
  it("reads a channel column", () => {
    expect(multivarColumnValues(ds().data, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
  it("reads the x column at index -1", () => {
    expect(multivarColumnValues(ds().data, -1)).toEqual(ds().data.time);
  });
});

describe("listwiseComplete", () => {
  it("drops a row if ANY column is non-finite there", () => {
    const rows = listwiseComplete([
      [1, 2, NaN, 4],
      [10, 20, 30, Infinity],
    ]);
    expect(rows).toEqual([
      [1, 10],
      [2, 20],
    ]);
  });
  it("empty for fewer than 2 columns", () => {
    expect(listwiseComplete([[1, 2, 3]])).toEqual([]);
    expect(listwiseComplete([])).toEqual([]);
  });
  it("keeps every row when all finite", () => {
    expect(listwiseComplete([[1, 2], [3, 4]])).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });
});

describe("transposeRows", () => {
  it("round-trips with listwiseComplete's row-major shape", () => {
    const rows = [
      [1, 10],
      [2, 20],
      [3, 30],
    ];
    expect(transposeRows(rows)).toEqual([
      [1, 2, 3],
      [10, 20, 30],
    ]);
  });
  it("empty in, empty out", () => {
    expect(transposeRows([])).toEqual([]);
  });
});

describe("downsampleIndices", () => {
  it("returns every index unchanged when n <= cap", () => {
    expect(downsampleIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
  });
  it("caps at exactly `cap` indices when n > cap", () => {
    const idx = downsampleIndices(10000, 5000);
    expect(idx.length).toBe(5000);
  });
  it("is deterministic — the same n/cap always returns the same indices", () => {
    expect(downsampleIndices(10000, 100)).toEqual(downsampleIndices(10000, 100));
  });
  it("indices stay in range and strictly increasing", () => {
    const idx = downsampleIndices(1000, 100);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    expect(idx[idx.length - 1]).toBeLessThan(1000);
  });
});

describe("miniHistogram", () => {
  it("bins finite values, ignoring NaN/Infinity", () => {
    const h = miniHistogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, NaN, Infinity], 5);
    expect(h.counts.length).toBe(5);
    expect(h.counts.reduce((s, c) => s + c, 0)).toBe(10);
    expect(h.max).toBe(Math.max(...h.counts));
  });
  it("degenerate (constant) values collapse to one bin holding everything", () => {
    expect(miniHistogram([5, 5, 5])).toEqual({ counts: [3], max: 3 });
  });
  it("empty for no finite values", () => {
    expect(miniHistogram([NaN, Infinity])).toEqual({ counts: [], max: 0 });
  });
});

describe("correlationToTSV", () => {
  it("builds a header row + one row per label", () => {
    const tsv = correlationToTSV(["a", "b"], [
      [1, 0.5],
      [0.5, 1],
    ]);
    const lines = tsv.split("\n");
    expect(lines[0]).toBe("\ta\tb");
    expect(lines[1]).toBe("a\t1.0000\t0.5000");
    expect(lines[2]).toBe("b\t0.5000\t1.0000");
  });
});
