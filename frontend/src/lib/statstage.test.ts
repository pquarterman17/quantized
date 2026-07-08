import { describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "./types";
import {
  boxStatsClient,
  categoricalChannels,
  categorySlots,
  finiteDomain,
  firstValueChannel,
  groupBoxStatsClient,
  resolveGroups,
  violinOutline,
  zeroBasedDomain,
} from "./statstage";

// ── boxStatsClient (cross-checked against calc.statplots.box_stats) ─────────
describe("boxStatsClient", () => {
  it("matches the backend's box_stats oracle exactly (11-point sample w/ one outlier)", () => {
    // Oracle: python -c "from quantized.calc.statplots import box_stats;
    // print(box_stats([1,2,3,4,5,6,7,8,9,10,50]))" ->
    // q1=3.5 median=6.0 q3=8.5 iqr=5.0 whislo=1.0 whishi=10.0
    // mean=9.545454545454545 fliers=[50.0]
    const b = boxStatsClient([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50]);
    expect(b.q1).toBeCloseTo(3.5, 9);
    expect(b.median).toBeCloseTo(6.0, 9);
    expect(b.q3).toBeCloseTo(8.5, 9);
    expect(b.iqr).toBeCloseTo(5.0, 9);
    expect(b.whislo).toBeCloseTo(1.0, 9);
    expect(b.whishi).toBeCloseTo(10.0, 9);
    expect(b.mean).toBeCloseTo(9.545454545454545, 9);
    expect(b.n).toBe(11);
    expect(b.fliers).toEqual([50]);
  });

  it("drops non-finite values before computing", () => {
    const b = boxStatsClient([1, 2, 3, NaN, Infinity, 4, 5]);
    expect(b.n).toBe(5);
  });

  it("throws on an all-non-finite sample", () => {
    expect(() => boxStatsClient([NaN, Infinity])).toThrow();
  });

  it("'range' whis uses min/max with no fliers", () => {
    const b = boxStatsClient([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50], "range");
    expect(b.whislo).toBe(1);
    expect(b.whishi).toBe(50);
    expect(b.fliers).toEqual([]);
  });

  it("carries the group label through", () => {
    expect(boxStatsClient([1, 2, 3], 1.5, "sample A").label).toBe("sample A");
  });
});

describe("groupBoxStatsClient", () => {
  it("computes one BoxStat per group, preserving order", () => {
    const groups = [
      { label: "a", values: [1, 2, 3, 4, 5] },
      { label: "b", values: [10, 20, 30, 40, 50] },
    ];
    const out = groupBoxStatsClient(groups);
    expect(out.map((b) => b.label)).toEqual(["a", "b"]);
    expect(out[0].median).toBeCloseTo(3, 9);
    expect(out[1].median).toBeCloseTo(30, 9);
  });
});

// ── grouping ─────────────────────────────────────────────────────────────────
function makeDataset(labels: string[], rows: number[][]): Dataset {
  const data: DataStruct = {
    time: rows.map((_, i) => i),
    values: rows,
    labels,
    units: labels.map(() => ""),
    metadata: {},
  };
  return { id: "d1", name: "d1", data };
}

describe("categoricalChannels / firstValueChannel", () => {
  // 12+ rows needed for inference (MIN_SAMPLES); nominal = <=8 distinct
  // levels each used >=3x on average.
  const rows = Array.from({ length: 15 }, (_, i) => [i % 3, i * 1.1]);
  const ds = makeDataset(["group", "value"], rows);

  it("flags the few-level column as categorical, not the continuous one", () => {
    expect(categoricalChannels(ds)).toEqual([0]);
  });

  it("picks the first continuous channel other than the group column", () => {
    expect(firstValueChannel(ds, 0)).toBe(1);
  });

  it("returns 0 for a null dataset / falls back sanely", () => {
    expect(categoricalChannels(null)).toEqual([]);
    expect(firstValueChannel(null, -1)).toBe(0);
  });
});

describe("resolveGroups", () => {
  const rows = Array.from({ length: 15 }, (_, i) => [i % 3, i * 1.1, i * 2.2]);
  const ds = makeDataset(["group", "valA", "valB"], rows);

  it("partitions the value column by the categorical column when groupCol is given", () => {
    const groups = resolveGroups(ds.data, 0, 1, [1, 2]);
    expect(groups).toHaveLength(3); // levels 0, 1, 2
    expect(groups.map((g) => g.label)).toEqual(["group = 0", "group = 1", "group = 2"]);
  });

  it("falls back to one group per plotted channel when groupCol is null", () => {
    const groups = resolveGroups(ds.data, null, 1, [1, 2]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.label)).toEqual(["valA", "valB"]);
  });

  it("falls back to [valueCol] when nothing is plotted", () => {
    const groups = resolveGroups(ds.data, null, 1, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("valA");
  });
});

// ── scale / layout math ──────────────────────────────────────────────────────
describe("finiteDomain", () => {
  it("pads a normal range", () => {
    const [lo, hi] = finiteDomain([[1, 2, 3, 4, 5]]);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(5);
  });

  it("widens a degenerate (single-value) range", () => {
    const [lo, hi] = finiteDomain([[5, 5, 5]]);
    expect(lo).toBeLessThan(5);
    expect(hi).toBeGreaterThan(5);
  });

  it("returns [0,1] when nothing is finite", () => {
    expect(finiteDomain([[NaN, Infinity]])).toEqual([0, 1]);
  });

  it("spans across multiple lists (e.g. one box's whiskers + fliers)", () => {
    const [, hi] = finiteDomain([[3, 8], [50]]);
    expect(hi).toBeGreaterThan(50);
  });
});

describe("zeroBasedDomain", () => {
  it("always starts at 0 and pads the top", () => {
    expect(zeroBasedDomain([[1, 5, 3]])).toEqual([0, 5 * 1.08]);
  });

  it("returns [0,1] for an all-zero / empty input", () => {
    expect(zeroBasedDomain([[0, 0]])).toEqual([0, 1]);
    expect(zeroBasedDomain([[]])).toEqual([0, 1]);
  });
});

describe("categorySlots", () => {
  it("spaces n slots evenly across [0,1] with no overlap", () => {
    const slots = categorySlots(4);
    expect(slots).toHaveLength(4);
    expect(slots.map((s) => s.cx)).toEqual([0.125, 0.375, 0.625, 0.875]);
    // Adjacent boxes never touch: half-width * 2 < slot pitch (0.25).
    for (const s of slots) expect(s.halfWidth * 2).toBeLessThan(0.25);
  });

  it("returns an empty array for n<=0", () => {
    expect(categorySlots(0)).toEqual([]);
  });
});

describe("violinOutline", () => {
  it("normalizes the density peak to half-width 1", () => {
    const out = violinOutline([0, 1, 2], [0, 4, 2]);
    expect(out.map((p) => p.halfWidth)).toEqual([0, 1, 0.5]);
  });

  it("returns all-zero half-widths for a flat/zero density", () => {
    const out = violinOutline([0, 1], [0, 0]);
    expect(out.every((p) => p.halfWidth === 0)).toBe(true);
  });
});
