import { describe, expect, it } from "vitest";

import { AGG_KEYS, tabulate } from "./tabulate";

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
