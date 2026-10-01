// Perf audit 2026-10-01: adding, editing or removing a computed column
// evaluates the formula list ONCE. `withRecomputedFormulas` called
// `applyFormulas` and then `formulaErrors`, and each re-ran every formula over
// every row (3 formulas at 1M rows: 6.9 s, half of it thrown away). An
// aggregate reduces once per evaluation pass (formulaAggregateOnce.test.ts),
// so its call count counts the passes; it must not depend on the row count.

import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/formulaAggregates", async (orig) => {
  const mod = await orig<typeof import("../lib/formulaAggregates")>();
  return { ...mod, computeAggregate: vi.fn(mod.computeAggregate) };
});

import { applyFormulas, formulaErrors } from "../lib/formula";
import { computeAggregate } from "../lib/formulaAggregates";
import { recomputeFromBase } from "../lib/formulaInputs";
import type { ComputedColumn, DataStruct } from "../lib/types";
import { withRecomputedFormulas } from "./computedColumns";

function table(n: number): DataStruct {
  return {
    time: Array.from({ length: n }, (_, i) => i),
    values: Array.from({ length: n }, (_, i) => [i % 5]),
    labels: ["a"],
    units: [""],
    metadata: {},
  };
}

describe("withRecomputedFormulas evaluates the formula list once", () => {
  it.each([
    ["withRecomputedFormulas", (b: DataStruct, f: ComputedColumn[]) => withRecomputedFormulas(b, f)],
    ["recomputeFromBase", (b: DataStruct, f: ComputedColumn[]) => recomputeFromBase(b, f)],
  ])("%s: one evaluation pass at 100 and at 400 rows", (_name, run) => {
    const formulas = [{ name: "F", expr: "A - mean(A)" }] as ComputedColumn[];
    for (const n of [100, 400]) {
      vi.mocked(computeAggregate).mockClear();
      run(table(n), formulas);
      expect(vi.mocked(computeAggregate)).toHaveBeenCalledTimes(1);
    }
  });

  it("returns what the two separate calls returned", () => {
    const base = table(12);
    const formulas = [
      { name: "F", expr: "A - mean(A)" },
      { name: "G", expr: "nosuch + 1" },
    ] as ComputedColumn[];
    const out = withRecomputedFormulas(base, formulas);
    expect(out.data).toEqual(applyFormulas(base, formulas));
    expect(out.formulaErrors).toEqual(formulaErrors(base, formulas));
    expect(withRecomputedFormulas(base, [formulas[0]]).formulaErrors).toBeUndefined();
  });
});
