// SILENT_STATE_CORRUPTION_PLAN #2: the branded StrippableData type and the
// non-stripping recomputeFromBase helper. See formulaInputs.ts's module doc
// for why these exist; formula.test.ts covers the compile-time guard on
// recomputeWithErrors itself.

import { describe, expect, it } from "vitest";

import { applyFormulas, baseColumns, formulaErrors } from "./formula";
import { asAlreadyComputed, recomputeFromBase } from "./formulaInputs";
import type { ComputedColumn, DataStruct } from "./types";

const base: DataStruct = {
  time: [1, 2, 3],
  values: [
    [1, 10],
    [2, 20],
    [3, 30],
  ],
  labels: ["A", "B"],
  units: ["u", "v"],
  metadata: {},
};

describe("asAlreadyComputed", () => {
  it("is a pure passthrough at runtime — an identity assertion, not a transform", () => {
    expect(asAlreadyComputed(base)).toBe(base);
  });
});

describe("recomputeFromBase", () => {
  it("appends formulas onto a base WITHOUT stripping any existing column (the #4/#245 fix)", () => {
    // `base` has 2 columns and formulas.length is 1 -- a STRIPPING recompute
    // (recomputeWithErrors) would eat column "B" here. recomputeFromBase
    // must not: both base columns survive, and the formula appends after them.
    const formulas: ComputedColumn[] = [{ name: "F1", expr: "A + B" }];
    const { data, errors } = recomputeFromBase(base, formulas);
    expect(data.labels).toEqual(["A", "B", "F1"]);
    expect(data.values).toEqual([
      [1, 10, 11],
      [2, 20, 22],
      [3, 30, 33],
    ]);
    expect(errors).toEqual({});
  });

  it("matches applyFormulas/formulaErrors called separately on the SAME base (never a divergent path)", () => {
    const formulas: ComputedColumn[] = [{ name: "bad", expr: "A +" }, { name: "F1", expr: "A + B" }];
    const result = recomputeFromBase(base, formulas);
    expect(result.data).toEqual(applyFormulas(base, formulas));
    expect(result.errors).toEqual(formulaErrors(base, formulas));
    expect(Object.keys(result.errors)).toEqual(["bad"]);
  });

  it("never strips, even when the base's column count happens to equal formulas.length", () => {
    // The exact shape that trips up a stripping recompute: base has as many
    // columns as there are formulas, so baseColumns(base, 1) would keep only
    // 1 of the 2 base columns if this routed through the stripping path.
    const oneColBase: DataStruct = { ...base, labels: ["A"], units: ["u"], values: [[1], [2], [3]] };
    const formulas: ComputedColumn[] = [{ name: "F1", expr: "A * 2" }];
    const { data } = recomputeFromBase(oneColBase, formulas);
    expect(data.labels).toEqual(["A", "F1"]);
    expect(data.values).toEqual([[1, 2], [2, 4], [3, 6]]);
  });

  it("sanity: baseColumns WOULD have eaten a real column here — proving recomputeFromBase's non-stripping path matters", () => {
    const formulas: ComputedColumn[] = [{ name: "F1", expr: "A + B" }];
    expect(baseColumns(base, formulas.length).labels).toEqual(["A"]); // "B" gone
    expect(recomputeFromBase(base, formulas).data.labels).toEqual(["A", "B", "F1"]); // "B" kept
  });
});
