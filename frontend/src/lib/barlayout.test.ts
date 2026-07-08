import { describe, expect, it } from "vitest";

import {
  buildBarMatrix,
  categoryLevels,
  groupedBarSlots,
  resolveCategoryLabels,
  seriesStat,
  stackedSegments,
  stackedTotal,
} from "./barlayout";
import type { DataStruct } from "./types";

describe("categoryLevels", () => {
  it("returns distinct finite values ascending", () => {
    const ds: DataStruct = {
      time: [0, 1, 2, 3, 4],
      values: [[2], [1], [2], [1], [3]],
      labels: ["grp"],
      units: [""],
      metadata: {},
    };
    expect(categoryLevels(ds, 0)).toEqual([1, 2, 3]);
  });

  it("skips non-finite values and supports channel<0 (time column)", () => {
    const ds: DataStruct = {
      time: [1, 1, NaN, 2],
      values: [[0], [0], [0], [0]],
      labels: ["x"],
      units: [""],
      metadata: {},
    };
    expect(categoryLevels(ds, -1)).toEqual([1, 2]);
  });
});

describe("resolveCategoryLabels (RESOLVED decision: text column then numeric fallback)", () => {
  const base: DataStruct = {
    time: [0, 1, 2, 3],
    values: [[1], [2], [1], [2]],
    labels: ["group"],
    units: [""],
    metadata: {},
  };

  it("falls back to formatted numeric levels with no text columns", () => {
    expect(resolveCategoryLabels(base, 0, [1, 2])).toEqual(["1", "2"]);
  });

  it("uses an Origin text column that consistently labels every level", () => {
    const ds: DataStruct = {
      ...base,
      metadata: { origin_text_columns: { B: ["Room A", "Room B", "Room A", "Room B"] } },
    };
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["Room A", "Room B"]);
  });

  it("ignores a text column that disagrees with itself on some level", () => {
    const ds: DataStruct = {
      ...base,
      // level 1 maps to "Room A" on row 0 but "Nope" on row 2 -> disqualified.
      metadata: { origin_text_columns: { B: ["Room A", "Room B", "Nope", "Room B"] } },
    };
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["1", "2"]);
  });

  it("ignores a text column that doesn't cover every level", () => {
    const ds: DataStruct = {
      ...base,
      metadata: { origin_text_columns: { B: ["Room A", "", "Room A", ""] } }, // level 2 never labeled
    };
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["1", "2"]);
  });

  it("picks the first qualifying column in deterministic (sorted) key order", () => {
    const ds: DataStruct = {
      ...base,
      metadata: {
        origin_text_columns: {
          C: ["x", "y", "x", "y"], // doesn't qualify (not level-consistent labels we'd prefer)
          B: ["Room A", "Room B", "Room A", "Room B"],
        },
      },
    };
    // Both "B" and "C" qualify structurally; B sorts first (length-then-lex).
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["Room A", "Room B"]);
  });

  it("formats whole numbers without a trailing .0", () => {
    expect(resolveCategoryLabels(base, 0, [1, 2])).toEqual(["1", "2"]);
    const frac: DataStruct = { ...base, values: [[1.5], [2.25], [1.5], [2.25]] };
    expect(resolveCategoryLabels(frac, 0, [1.5, 2.25])).toEqual(["1.5", "2.25"]);
  });
});

describe("seriesStat", () => {
  it("computes mean and NaN sem for n<2", () => {
    expect(seriesStat([])).toEqual({ mean: NaN, sem: NaN, n: 0 });
    const one = seriesStat([5]);
    expect(one.mean).toBe(5);
    expect(one.n).toBe(1);
    expect(Number.isNaN(one.sem)).toBe(true);
  });

  it("computes sample SEM (Bessel-corrected) for n>=2", () => {
    // values 2,4,6,8: mean=5, sample variance=(9+1+1+9)/3=20/3, sem=sqrt(20/3/4)
    const s = seriesStat([2, 4, 6, 8]);
    expect(s.n).toBe(4);
    expect(s.mean).toBeCloseTo(5, 10);
    expect(s.sem).toBeCloseTo(Math.sqrt(20 / 3 / 4), 10);
  });

  it("ignores non-finite values", () => {
    expect(seriesStat([1, NaN, 3, Infinity])).toEqual({ mean: 2, sem: expect.any(Number), n: 2 });
  });
});

describe("buildBarMatrix", () => {
  it("builds one group per category level, one BarSeriesStat per value channel", () => {
    // group col 0: levels 1,1,2,2 ; value channels 1 (A) and 2 (B)
    const ds: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [1, 10, 100],
        [1, 20, 200],
        [2, 30, 300],
        [2, 40, 400],
      ],
      labels: ["grp", "A", "B"],
      units: ["", "", ""],
      metadata: {},
    };
    const m = buildBarMatrix(ds, 0, [1, 2], ["A", "B"]);
    expect(m.seriesLabels).toEqual(["A", "B"]);
    expect(m.groups).toHaveLength(2);
    expect(m.groups[0].label).toBe("1");
    expect(m.groups[0].series[0].mean).toBeCloseTo(15, 10); // (10+20)/2
    expect(m.groups[0].series[1].mean).toBeCloseTo(150, 10); // (100+200)/2
    expect(m.groups[1].label).toBe("2");
    expect(m.groups[1].series[0].mean).toBeCloseTo(35, 10); // (30+40)/2
  });

  it("handles a single value channel (ordinary single-series bar chart)", () => {
    const ds: DataStruct = {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [1, 30]],
      labels: ["grp", "val"],
      units: ["", ""],
      metadata: {},
    };
    const m = buildBarMatrix(ds, 0, [1], ["val"]);
    expect(m.groups).toHaveLength(2);
    expect(m.groups[0].series).toHaveLength(1);
    expect(m.groups[0].series[0].mean).toBeCloseTo(20, 10); // (10+30)/2 for level 1
  });

  it("returns an empty-n stat (NaN mean) for a category level with no finite values in a channel", () => {
    const ds: DataStruct = {
      time: [0, 1],
      values: [[1, NaN], [2, 5]],
      labels: ["grp", "val"],
      units: ["", ""],
      metadata: {},
    };
    const m = buildBarMatrix(ds, 0, [1], ["val"]);
    expect(m.groups[0].series[0].n).toBe(0);
    expect(Number.isNaN(m.groups[0].series[0].mean)).toBe(true);
  });
});

describe("groupedBarSlots", () => {
  it("returns [] for n<=0", () => {
    expect(groupedBarSlots(0)).toEqual([]);
    expect(groupedBarSlots(-1)).toEqual([]);
  });

  it("centers a single series at offset 0", () => {
    const slots = groupedBarSlots(1);
    expect(slots).toHaveLength(1);
    expect(slots[0].offset).toBeCloseTo(0, 10);
    expect(slots[0].halfWidth).toBeCloseTo(0.425, 10); // (1*(1-0.15))/2
  });

  it("splits two series symmetrically around zero with a gap between them", () => {
    const slots = groupedBarSlots(2);
    expect(slots).toHaveLength(2);
    expect(slots[0].offset).toBeCloseTo(-0.25, 10);
    expect(slots[1].offset).toBeCloseTo(0.25, 10);
    // Bars must not overlap: right edge of slot 0 <= left edge of slot 1.
    expect(slots[0].offset + slots[0].halfWidth).toBeLessThanOrEqual(slots[1].offset - slots[1].halfWidth + 1e-9);
  });

  it("keeps three-or-more series non-overlapping and symmetric", () => {
    const slots = groupedBarSlots(3);
    expect(slots).toHaveLength(3);
    // Symmetric around 0.
    expect(slots[0].offset).toBeCloseTo(-slots[2].offset, 10);
    expect(slots[1].offset).toBeCloseTo(0, 10);
    for (let i = 0; i < slots.length - 1; i++) {
      expect(slots[i].offset + slots[i].halfWidth).toBeLessThanOrEqual(
        slots[i + 1].offset - slots[i + 1].halfWidth + 1e-9,
      );
    }
  });
});

describe("stackedSegments / stackedTotal", () => {
  it("accumulates bottom-to-top in series order", () => {
    const series = [seriesStat([10]), seriesStat([20]), seriesStat([5])];
    const segs = stackedSegments(series);
    expect(segs).toEqual([
      { base: 0, top: 10 },
      { base: 10, top: 30 },
      { base: 30, top: 35 },
    ]);
    expect(stackedTotal(series)).toBe(35);
  });

  it("treats a non-finite (empty) group's mean as zero contribution", () => {
    const series = [seriesStat([10]), seriesStat([]), seriesStat([5])];
    const segs = stackedSegments(series);
    expect(segs[1]).toEqual({ base: 10, top: 10 }); // zero-height segment
    expect(segs[2]).toEqual({ base: 10, top: 15 });
    expect(stackedTotal(series)).toBe(15);
  });

  it("returns 0 for an empty series list", () => {
    expect(stackedSegments([])).toEqual([]);
    expect(stackedTotal([])).toBe(0);
  });
});
