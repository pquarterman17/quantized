// Perf audit 2026-10-01: a whole-column aggregate in a formula (`A - mean(A)`)
// must reduce the column ONCE per recompute, not once per row. Per row it was
// O(n) work per row, O(n^2) per column: 1M rows never finished, and `median`
// re-sorted the column on every row. The call count is the load-invariant
// signal, so it is asserted at two sizes and must not grow with the row count.

import { describe, expect, it, vi } from "vitest";

vi.mock("./formulaAggregates", async (orig) => {
  const mod = await orig<typeof import("./formulaAggregates")>();
  return { ...mod, computeAggregate: vi.fn(mod.computeAggregate) };
});

import { applyFormulas } from "./formula";
import { computeAggregate } from "./formulaAggregates";
import type { ComputedColumn, DataStruct } from "./types";

function table(n: number): DataStruct {
  return {
    time: Array.from({ length: n }, (_, i) => i),
    values: Array.from({ length: n }, (_, i) => [i % 7, (i * 3) % 11]),
    labels: ["a", "b"],
    units: ["", ""],
    metadata: {},
  };
}

const col = (expr: string): ComputedColumn => ({ name: "F", expr }) as ComputedColumn;

describe("formula aggregates reduce each column once per recompute", () => {
  it.each([
    ["mean", "A - mean(A)"],
    ["median", "B - median(B)"],
    ["sd over x", "x / sd(x)"],
  ])("%s: one reduction at 200 rows and at 800 rows", (_name, expr) => {
    for (const n of [200, 800]) {
      vi.mocked(computeAggregate).mockClear();
      applyFormulas(table(n), [col(expr)]);
      expect(vi.mocked(computeAggregate)).toHaveBeenCalledTimes(1);
    }
  });

  it("two aggregates over the same column reduce once each", () => {
    vi.mocked(computeAggregate).mockClear();
    applyFormulas(table(300), [col("(A - mean(A)) / sd(A)")]);
    expect(vi.mocked(computeAggregate)).toHaveBeenCalledTimes(2);
  });

  it("values match the per-row definition", () => {
    const data = table(9);
    const out = applyFormulas(data, [col("A - mean(A)"), col("median(B)")]);
    const a = data.values.map((r) => r[0]);
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const sortedB = data.values.map((r) => r[1]).sort((p, q) => p - q);
    out.values.forEach((row, r) => {
      expect(row[2]).toBeCloseTo(a[r] - mean, 12);
      expect(row[3]).toBe(sortedB[4]);
    });
  });

  it("a later formula sees an earlier column's own aggregate, not a stale one", () => {
    const out = applyFormulas(table(10), [col("A * 2"), { name: "G", expr: "mean(C)" } as ComputedColumn]);
    const c = out.values.map((r) => r[2]);
    const mean = c.reduce((s, v) => s + v, 0) / c.length;
    out.values.forEach((row) => expect(row[3]).toBeCloseTo(mean, 12));
  });
});
