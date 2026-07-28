import { describe, expect, it } from "vitest";

import { AGG_KEYS, computeStats, STAT_KEYS, tabulate, tabulateNested } from "./tabulate";

describe("tabulate", () => {
  it("groups a value column by a categorical column with full descriptive stats", () => {
    const by = [1, 1, 2, 2, 2];
    const value = [10, 20, 5, 15, 25];
    const rows = tabulate(by, value);
    expect(rows).toHaveLength(2);

    const g1 = rows[0];
    expect(g1.group).toBe(1);
    expect(g1.count).toBe(2);
    expect(g1.mean).toBe(15);
    expect(g1.sd).toBeCloseTo(Math.sqrt(50), 10); // sample sd, n-1
    expect(g1.min).toBe(10);
    expect(g1.max).toBe(20);
    expect(g1.median).toBe(15);

    const g2 = rows[1];
    expect(g2.group).toBe(2);
    expect(g2.count).toBe(3);
    expect(g2.mean).toBe(15);
    expect(g2.sd).toBeCloseTo(10, 10); // sqrt(((−10)²+0+10²)/2)=10
    expect(g2.min).toBe(5);
    expect(g2.max).toBe(25);
    expect(g2.median).toBe(15);
  });

  it("returns groups sorted ascending by key regardless of input order", () => {
    const rows = tabulate([3, 1, 2, 1], [1, 2, 3, 4]);
    expect(rows.map((r) => r.group)).toEqual([1, 2, 3]);
  });

  it("skips rows whose group key or value is non-finite", () => {
    const by = [1, Number.NaN, 2, 1];
    const value = [10, 20, Number.POSITIVE_INFINITY, 30];
    const rows = tabulate(by, value);
    // NaN key row dropped; group 2's only value is Infinity → group 2 absent.
    expect(rows.map((r) => r.group)).toEqual([1]);
    expect(rows[0].count).toBe(2); // values 10 and 30
    expect(rows[0].mean).toBe(20);
  });

  it("reports NaN sample sd for a single-value group but real min/max/median", () => {
    const rows = tabulate([7], [42]);
    expect(rows[0].count).toBe(1);
    expect(rows[0].mean).toBe(42);
    expect(Number.isNaN(rows[0].sd)).toBe(true);
    expect(rows[0].min).toBe(42);
    expect(rows[0].max).toBe(42);
    expect(rows[0].median).toBe(42);
  });

  it("computes the median as the mean of the two middles for an even count", () => {
    const rows = tabulate([1, 1, 1, 1], [4, 1, 3, 2]);
    expect(rows[0].median).toBe(2.5); // sorted [1,2,3,4] → (2+3)/2
  });

  it("truncates to the shorter of the two columns", () => {
    const rows = tabulate([1, 1, 2], [10, 20]); // value shorter → index 2 ignored
    expect(rows.map((r) => r.group)).toEqual([1]);
    expect(rows[0].count).toBe(2);
  });

  it("returns [] when nothing is finite", () => {
    expect(tabulate([Number.NaN], [Number.NaN])).toEqual([]);
    expect(tabulate([], [])).toEqual([]);
  });

  it("exposes the aggregate column order", () => {
    expect(AGG_KEYS).toEqual(["count", "mean", "sd", "min", "max", "median"]);
  });
});

describe("computeStats (v2 catalog)", () => {
  it("matches hand-computed sd/sem/quantiles/sum for a 6-value bucket", () => {
    // [10,12,14,16,18,20]: mean 15, deviations ±5/±3/±1, squares sum 70,
    // variance 70/5=14, sd=sqrt(14), sem=sd/sqrt(6).
    const s = computeStats([10, 12, 14, 16, 18, 20]);
    expect(s.count).toBe(6);
    expect(s.sum).toBe(90);
    expect(s.mean).toBe(15);
    expect(s.sd).toBeCloseTo(Math.sqrt(14), 12);
    expect(s.sem).toBeCloseTo(Math.sqrt(14) / Math.sqrt(6), 12);
    expect(s.median).toBe(15);
    expect(s.min).toBe(10);
    expect(s.max).toBe(20);
    // q1: rank=0.25*5=1.25 -> sorted[1]=12, sorted[2]=14 -> 12+0.25*2=12.5
    expect(s.q1).toBeCloseTo(12.5, 12);
    // q3: rank=0.75*5=3.75 -> sorted[3]=16, sorted[4]=18 -> 16+0.75*2=17.5
    expect(s.q3).toBeCloseTo(17.5, 12);
  });

  it("reports NaN sem for n<2 like sd, but a real q1/q3/sum for a single value", () => {
    const s = computeStats([42]);
    expect(s.count).toBe(1);
    expect(Number.isNaN(s.sd)).toBe(true);
    expect(Number.isNaN(s.sem)).toBe(true);
    expect(s.sum).toBe(42);
    expect(s.q1).toBe(42);
    expect(s.q3).toBe(42);
  });

  it("reports count 0 and NaN everywhere for an empty bucket", () => {
    const s = computeStats([]);
    expect(s.count).toBe(0);
    for (const k of STAT_KEYS) {
      if (k === "count") continue;
      expect(Number.isNaN(s[k]), `${k} should be NaN`).toBe(true);
    }
  });

  it("exposes the v2 stat catalog order", () => {
    expect(STAT_KEYS).toEqual([
      "count", "mean", "sd", "sem", "min", "max", "median", "sum", "q1", "q3",
    ]);
  });
});

describe("tabulateNested", () => {
  it("nests 2 group columns depth-first (outer then inner, both ascending)", () => {
    // site: 1,1,1,1,2,2,2,2 ; batch: 1,1,2,2,1,1,2,2 ; value: 10..80
    const site = [1, 1, 1, 1, 2, 2, 2, 2];
    const batch = [1, 1, 2, 2, 1, 1, 2, 2];
    const value = [10, 20, 30, 40, 50, 60, 70, 80];
    const rows = tabulateNested([site, batch], [value]);
    expect(rows.map((r) => r.levels)).toEqual([
      [1, 1], [1, 2], [2, 1], [2, 2],
    ]);
    expect(rows[0].values[0].mean).toBe(15); // (10+20)/2
    expect(rows[1].values[0].mean).toBe(35);
    expect(rows[2].values[0].mean).toBe(55);
    expect(rows[3].values[0].mean).toBe(75);
  });

  it("nests 3 group columns depth-first", () => {
    const a = [1, 1, 2, 2];
    const b = [1, 2, 1, 2];
    const c = [9, 9, 9, 9];
    const value = [1, 2, 3, 4];
    const rows = tabulateNested([a, b, c], [value]);
    expect(rows.map((r) => r.levels)).toEqual([
      [1, 1, 9], [1, 2, 9], [2, 1, 9], [2, 2, 9],
    ]);
    expect(rows.map((r) => r.values[0].sum)).toEqual([1, 2, 3, 4]);
  });

  it("computes independent per-value-column stats for multiple value columns", () => {
    const grp = [1, 1, 1, 2, 2, 2];
    const a = [10, 20, 30, 1, 2, 3];
    const b = [100, 200, 300, 5, 6, 7];
    const rows = tabulateNested([grp], [a, b]);
    expect(rows[0].values[0].mean).toBe(20);
    expect(rows[0].values[1].mean).toBe(200);
    expect(rows[1].values[0].mean).toBe(2);
    expect(rows[1].values[1].mean).toBe(6);
  });

  it("keeps a group row alive when only SOME value columns have finite data in it", () => {
    // group codes are always finite (1,1,2,2): valueA has data for group 1 only,
    // valueB has data for group 2 only — both groups must still appear, each
    // with a real cell for one value column and an empty (count 0, NaN) cell
    // for the other, rather than one group vanishing entirely.
    const grp = [1, 1, 2, 2];
    const valueA = [10, 20, Number.NaN, Number.NaN];
    const valueB = [Number.NaN, Number.NaN, 5, 7];
    const rows = tabulateNested([grp], [valueA, valueB]);
    expect(rows.map((r) => r.levels)).toEqual([[1], [2]]);

    const g1 = rows[0];
    expect(g1.values[0]).toMatchObject({ count: 2, mean: 15 });
    expect(g1.values[1].count).toBe(0);
    expect(Number.isNaN(g1.values[1].mean)).toBe(true);

    const g2 = rows[1];
    expect(g2.values[0].count).toBe(0);
    expect(Number.isNaN(g2.values[0].mean)).toBe(true);
    expect(g2.values[1]).toMatchObject({ count: 2, mean: 6 });
  });

  it("skips a row entirely when ANY group column is non-finite on it", () => {
    const site = [1, Number.NaN, 2];
    const batch = [1, 1, 2];
    const value = [10, 20, 30];
    const rows = tabulateNested([site, batch], [value]);
    expect(rows.map((r) => r.levels)).toEqual([[1, 1], [2, 2]]);
  });

  it("appends an optional grand-total row spanning every finite value, ignoring grouping", () => {
    const grp = [1, 1, 2, 2];
    const valueA = [10, 20, Number.NaN, Number.NaN];
    const valueB = [Number.NaN, Number.NaN, 5, 7];
    const rows = tabulateNested([grp], [valueA, valueB], { grandTotal: true });
    expect(rows).toHaveLength(3);
    const total = rows[2];
    expect(total.isTotal).toBe(true);
    expect(total.levels).toEqual([]);
    expect(total.values[0]).toMatchObject({ count: 2, sum: 30 }); // 10+20
    expect(total.values[1]).toMatchObject({ count: 2, sum: 12 }); // 5+7
  });

  it("omits the grand-total row by default", () => {
    const rows = tabulateNested([[1, 2]], [[10, 20]]);
    expect(rows.every((r) => !r.isTotal)).toBe(true);
  });

  it("returns [] with no group columns", () => {
    expect(tabulateNested([], [[1, 2, 3]])).toEqual([]);
  });

  it("truncates to the shortest column across groups and values", () => {
    const rows = tabulateNested([[1, 1, 2]], [[10, 20]]); // value shorter → row 2 ignored
    expect(rows.map((r) => r.levels)).toEqual([[1]]);
    expect(rows[0].values[0].count).toBe(2);
  });
});
