import { describe, expect, it } from "vitest";

import {
  applyFormulas,
  baseColumns,
  channelLetter,
  compileFormula,
  formulaErrors,
  recomputeWithErrors,
  referencedColumns,
} from "./formula";
import { asAlreadyComputed } from "./formulaInputs";
import type { ComputedColumn, DataStruct } from "./types";

const ev = (src: string, ctx: Record<string, number> = {}) => compileFormula(src)(ctx);

const base: DataStruct = {
  time: [1, 2],
  values: [
    [10, 20],
    [30, 40],
  ],
  labels: ["A", "B"],
  units: ["u", "v"],
  metadata: {},
};

describe("compileFormula — arithmetic", () => {
  it("respects precedence and associativity", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("2 ^ 3 ^ 2")).toBe(512); // right-assoc -> 2^9
    expect(ev("10 - 3 - 2")).toBe(5); // left-assoc
    expect(ev("7 % 3")).toBe(1);
  });
  it("handles unary minus and signed numbers", () => {
    expect(ev("-3 + 5")).toBe(2);
    expect(ev("-(2 ^ 2)")).toBe(-4);
    expect(ev("2 * -3")).toBe(-6);
    expect(ev("1e3 + 2.5e-1")).toBe(1000.25);
  });
});

describe("compileFormula — variables + functions", () => {
  it("reads column variables from the context", () => {
    expect(ev("2*A + B", { A: 3, B: 4 })).toBe(10);
    expect(ev("x / 2", { x: 9 })).toBe(4.5);
  });
  it("evaluates functions and constants", () => {
    expect(ev("sqrt(B)", { B: 16 })).toBe(4);
    expect(ev("max(A, B)", { A: 2, B: 7 })).toBe(7);
    expect(ev("cos(pi)")).toBeCloseTo(-1, 12);
    expect(ev("ln(e)")).toBeCloseTo(1, 12);
  });
  it("compiles once and evaluates per row", () => {
    const f = compileFormula("A*A + 1");
    expect(f({ A: 2 })).toBe(5);
    expect(f({ A: 3 })).toBe(10);
  });
});

describe("compileFormula — errors", () => {
  it("throws on parse + name errors", () => {
    expect(() => compileFormula("1 +")).toThrow();
    expect(() => compileFormula("(1 + 2")).toThrow();
    expect(() => compileFormula("1 2")).toThrow(/trailing/);
    expect(() => compileFormula("nope(1)")).toThrow(/unknown function/);
    expect(() => compileFormula("@")).toThrow();
  });
  it("throws when a referenced variable is absent", () => {
    expect(() => compileFormula("Z + 1")({ A: 1 })).toThrow(/unknown variable/);
  });
});

describe("channelLetter", () => {
  it("maps indices to spreadsheet letters", () => {
    expect(channelLetter(0)).toBe("A");
    expect(channelLetter(25)).toBe("Z");
    expect(channelLetter(26)).toBe("AA");
    expect(channelLetter(27)).toBe("AB");
  });
});

describe("computed columns", () => {
  it("applies a formula over x + channel letters", () => {
    const out = applyFormulas(base, [{ name: "S", expr: "A + B" }]);
    expect(out.labels).toEqual(["A", "B", "S"]);
    expect(out.values).toEqual([
      [10, 20, 30],
      [30, 40, 70],
    ]);
    expect(base.values[0]).toHaveLength(2); // input untouched (immutable)
  });

  it("evaluates formulas in order so a later one can reference an earlier (by letter)", () => {
    const out = applyFormulas(base, [
      { name: "S", expr: "A + B" }, // → column C (index 2)
      { name: "T", expr: "C * 2" }, // references the computed S
    ]);
    expect(out.values).toEqual([
      [10, 20, 30, 60],
      [30, 40, 70, 140],
    ]);
  });

  it("yields an all-NaN column for a broken formula (keeps indices stable)", () => {
    const out = applyFormulas(base, [{ name: "bad", expr: "A +" }]);
    expect(out.labels).toEqual(["A", "B", "bad"]);
    expect(out.values[0][2]).toBeNaN();
    expect(out.values[1][2]).toBeNaN();
  });

  it("baseColumns strips the last n columns", () => {
    const out = applyFormulas(base, [{ name: "S", expr: "A + B" }]);
    expect(baseColumns(out, 1)).toEqual(base);
    expect(baseColumns(base, 0)).toBe(base); // no-op
  });

  // SILENT_STATE_CORRUPTION_PLAN #8: `cat_levels` is column-index-keyed
  // (DataStruct.cat_levels, P1.4) but `baseColumns` only ever sliced
  // labels/units/values -- a stripped column's level table survived into
  // the "base" it was stripped OUT of, ready to re-land on whatever formula
  // column `computeFormulas` next assigns that same index.
  it("baseColumns strips cat_levels entries at/beyond the kept column count, not just labels/units/values", () => {
    const data: DataStruct = {
      time: [0, 1],
      values: [
        [0, 1],
        [1, 0],
      ],
      labels: ["A", "R1"],
      units: ["", ""],
      metadata: {},
      cat_levels: { 0: ["lo", "hi"], 1: ["x", "y"] },
    };
    const out = baseColumns(data, 1);
    expect(out.labels).toEqual(["A"]);
    // The kept column's own level table survives...
    expect(out.cat_levels).toEqual({ 0: ["lo", "hi"] });
    // ...but the stripped column's does not ride along as stale state.
    expect(out.cat_levels?.[1]).toBeUndefined();
  });

  it("baseColumns drops cat_levels entirely once every categorical column is stripped (never an empty stale object)", () => {
    const data: DataStruct = {
      time: [0, 1],
      values: [[0], [1]],
      labels: ["R1"],
      units: [""],
      metadata: {},
      cat_levels: { 0: ["x", "y"] },
    };
    expect(baseColumns(data, 1).cat_levels).toBeUndefined();
  });

  it("recomputeWithErrors does not re-seed a stale cat_levels entry onto a plain arithmetic column at the same index", () => {
    const data: DataStruct = {
      time: [0, 1],
      values: [
        [0, 5],
        [1, 6],
      ],
      labels: ["A", "F1"],
      units: ["", ""],
      metadata: {},
      // Stale: index 1 was categorical under a PREVIOUS formula list (e.g. a
      // recode column that has since been replaced by a plain arithmetic one).
      cat_levels: { 1: ["ghost"] },
    };
    const out = recomputeWithErrors(asAlreadyComputed(data), [{ name: "F1", expr: "A * 10" }]).data;
    expect(out.cat_levels).toBeUndefined();
  });

  it("recomputeWithErrors re-derives the computed column from an edited base that already carries it", () => {
    const withS = applyFormulas(base, [{ name: "S", expr: "A + B" }]);
    // Simulate a base edit: A[0] 10 → 100. `edited` already carries the
    // stale "S" column (like d.data everywhere `recompute` is called), so
    // asAlreadyComputed's assertion is honest here — see formulaInputs.ts.
    const edited: DataStruct = {
      ...withS,
      values: [
        [100, 20, 30],
        [30, 40, 70],
      ],
    };
    const out = recomputeWithErrors(asAlreadyComputed(edited), [{ name: "S", expr: "A + B" }]).data;
    expect(out.values[0][2]).toBe(120); // 100 + 20
    expect(out.values[1][2]).toBe(70); // unchanged row
  });

  it("recomputeWithErrors requires an explicit asAlreadyComputed assertion, not a bare DataStruct (Class B guard, compile-time)", () => {
    // @ts-expect-error — `base` is a plain DataStruct, not StrippableData.
    // Only `asAlreadyComputed` (lib/formulaInputs.ts) may vouch for it; if
    // that stops being enforced, tsc fails with "Unused '@ts-expect-error'
    // directive" instead (SILENT_STATE_CORRUPTION_PLAN #2).
    recomputeWithErrors(base, [{ name: "S", expr: "A + B" }]);
  });
});

// ---------------------------------------------------------------------------
// JMP_GAP J11 — formula language v2: comparisons, logicals, if(), aggregate
// references, row()/lag()/diff(). See formula.ts's module header for the
// full grammar + NaN-propagation rules this section is testing against.
// ---------------------------------------------------------------------------

describe("compileFormula — comparison operators", () => {
  it("evaluates every comparison to 1/0", () => {
    expect(ev("2 < 3")).toBe(1);
    expect(ev("3 < 2")).toBe(0);
    expect(ev("2 <= 2")).toBe(1);
    expect(ev("3 <= 2")).toBe(0);
    expect(ev("3 > 2")).toBe(1);
    expect(ev("2 > 3")).toBe(0);
    expect(ev("2 >= 2")).toBe(1);
    expect(ev("1 >= 2")).toBe(0);
    expect(ev("2 == 2")).toBe(1);
    expect(ev("2 == 3")).toBe(0);
    expect(ev("2 != 3")).toBe(1);
    expect(ev("2 != 2")).toBe(0);
  });

  it("binds looser than arithmetic (comparisons wrap arithmetic results)", () => {
    expect(ev("1 + 2 < 2 * 2")).toBe(1); // 3 < 4
    expect(ev("2 ^ 3 == 8")).toBe(1);
    expect(ev("A + B > 45", { A: 20, B: 30 })).toBe(1); // 50 > 45
  });

  it("does not chain (a second comparison is a parse error, not a range check)", () => {
    expect(() => compileFormula("1 < 2 < 3")).toThrow(/trailing/);
  });

  it("is NaN-safe: NaN on either side makes the comparison NaN, not 0", () => {
    expect(ev("A < 1", { A: NaN })).toBeNaN();
    expect(ev("1 < A", { A: NaN })).toBeNaN();
    expect(ev("A == A", { A: NaN })).toBeNaN(); // NaN != NaN, but this is NaN, not 0
  });

  it("composes with arithmetic since it yields a plain number", () => {
    expect(ev("(A > 0) * 5", { A: 3 })).toBe(5);
    expect(ev("(A > 0) * 5", { A: -3 })).toBe(0);
  });
});

describe("compileFormula — logical operators (and/or/not)", () => {
  it("evaluates and/or/not to 1/0", () => {
    expect(ev("1 and 1")).toBe(1);
    expect(ev("1 and 0")).toBe(0);
    expect(ev("0 or 0")).toBe(0);
    expect(ev("0 or 1")).toBe(1);
    expect(ev("not 0")).toBe(1);
    expect(ev("not 1")).toBe(0);
    expect(ev("not not 1")).toBe(1);
  });

  it("precedence: not > and > or, and all bind looser than comparisons", () => {
    // "not 1 == 1" == "not (1 == 1)" == not(true) == 0 — not is a unary
    // prefix on the comparison that follows it, not on a bare "1".
    expect(ev("not 1 == 1")).toBe(0);
    expect(ev("not 1 == 2")).toBe(1);
    // "A > 0 and B > 0 or C > 0" == "(A > 0 and B > 0) or (C > 0)"
    expect(ev("A > 0 and B > 0 or C > 0", { A: -1, B: -1, C: 1 })).toBe(1);
    expect(ev("A > 0 and B > 0 or C > 0", { A: 1, B: 1, C: -1 })).toBe(1);
    expect(ev("A > 0 and B > 0 or C > 0", { A: 1, B: -1, C: -1 })).toBe(0);
    // "not A > 0 and B > 0" == "(not (A > 0)) and (B > 0)"
    expect(ev("not A > 0 and B > 0", { A: -1, B: 1 })).toBe(1);
    expect(ev("not A > 0 and B > 0", { A: 1, B: 1 })).toBe(0);
  });

  it("is right-associative / stacks under repeated not", () => {
    expect(ev("not not not 0")).toBe(1);
    expect(ev("not not not not 0")).toBe(0);
  });

  it("is NaN-safe: NaN in either operand makes the result NaN, no short-circuit", () => {
    expect(ev("A and 0", { A: NaN })).toBeNaN(); // NOT forced to 0 by the false operand
    expect(ev("A or 1", { A: NaN })).toBeNaN(); // NOT forced to 1 by the true operand
    expect(ev("not A", { A: NaN })).toBeNaN();
  });

  it("rejects and/or/not used as function calls (they are keywords, not FUNCS)", () => {
    expect(() => compileFormula("and(1, 2)")).toThrow(/unknown function "and"/);
  });

  it("a bare and/or/not (no operand) behaves like any other undefined identifier", () => {
    expect(() => compileFormula("and")({})).toThrow(/unknown variable "and"/);
  });
});

describe("compileFormula — if(cond, a, b)", () => {
  it("selects the true/false branch on a plain 1/0 condition", () => {
    expect(ev("if(1, 10, 20)")).toBe(10);
    expect(ev("if(0, 10, 20)")).toBe(20);
  });

  it("treats any nonzero condition as true (not just 1)", () => {
    expect(ev("if(-3, 10, 20)")).toBe(10);
    expect(ev("if(0.001, 10, 20)")).toBe(10);
  });

  it("works with a comparison/logical condition, matching JMP-formula usage", () => {
    expect(ev("if(A > 0, 1, -1)", { A: 5 })).toBe(1);
    expect(ev("if(A > 0, 1, -1)", { A: -5 })).toBe(-1);
    expect(ev("if(A > 0 and B > 0, A + B, 0)", { A: 2, B: 3 })).toBe(5);
    expect(ev("if(A > 0 and B > 0, A + B, 0)", { A: 2, B: -3 })).toBe(0);
  });

  it("is NaN-safe: a NaN condition yields NaN (branches not evaluated)", () => {
    expect(ev("if(A > 0, 1, 2)", { A: NaN })).toBeNaN();
    // The untaken branch may itself be broken — proves it's never evaluated
    // when the condition already resolves (not just when cond is NaN).
    expect(ev("if(1, 10, Z + 1)")).toBe(10);
    expect(ev("if(0, Z + 1, 20)")).toBe(20);
  });

  it("nests", () => {
    const grade = "if(A >= 90, 1, if(A >= 80, 2, if(A >= 70, 3, 4)))";
    expect(ev(grade, { A: 95 })).toBe(1);
    expect(ev(grade, { A: 85 })).toBe(2);
    expect(ev(grade, { A: 72 })).toBe(3);
    expect(ev(grade, { A: 50 })).toBe(4);
  });
});

describe("compileFormula — division/modulo edge cases", () => {
  it("division by zero follows IEEE 754, not a thrown error", () => {
    expect(ev("1 / 0")).toBe(Infinity);
    expect(ev("-1 / 0")).toBe(-Infinity);
    expect(ev("0 / 0")).toBeNaN();
  });

  it("comparisons against +/-Infinity behave sensibly", () => {
    expect(ev("1 / 0 > 1000000")).toBe(1);
    expect(ev("0 / 0 > 0")).toBeNaN();
  });
});

describe("compileFormula — deep nesting", () => {
  it("evaluates deeply parenthesized arithmetic correctly", () => {
    expect(ev("((((((1 + 1) * 2) - 3) ^ 2) / 5))")).toBeCloseTo(0.2, 12);
  });

  it("evaluates stacked unary minus (even/odd cancellation)", () => {
    expect(ev("----5")).toBe(5);
    expect(ev("-----5")).toBe(-5);
  });

  it("evaluates deeply nested if()/logical expressions", () => {
    const deep =
      "if(A > 0, if(B > 0, if(C > 0, 1, 2), if(C > 0, 3, 4)), if(B > 0, if(C > 0, 5, 6), if(C > 0, 7, 8)))";
    expect(ev(deep, { A: 1, B: 1, C: 1 })).toBe(1);
    expect(ev(deep, { A: 1, B: 1, C: -1 })).toBe(2);
    expect(ev(deep, { A: 1, B: -1, C: 1 })).toBe(3);
    expect(ev(deep, { A: -1, B: -1, C: -1 })).toBe(8);
  });

  it("evaluates a long and/or chain", () => {
    expect(ev("1 and 1 and 1 and 1 and 0")).toBe(0);
    expect(ev("0 or 0 or 0 or 0 or 1")).toBe(1);
  });
});

describe("compileFormula — aggregate references (mean/sd/min/max/median/sum/count)", () => {
  // Hand-computed fixture: mean=3, sum=15, count=5 (of the 5 finite values),
  // median=3, sd (sample, N-1) = sqrt(10/4) = sqrt(2.5).
  const colWithNaN = [1, 2, 3, 4, NaN, 5];
  const rowCtx = (columns: Record<string, number[]>) => ({ row: 0, rowCount: columns.A.length, columns });

  it("computes each aggregate over a column with a NaN entry (skips it — omitnan)", () => {
    const columns = { A: colWithNaN };
    expect(compileFormula("mean(A)")({}, rowCtx(columns))).toBeCloseTo(3, 12);
    expect(compileFormula("sum(A)")({}, rowCtx(columns))).toBeCloseTo(15, 12);
    expect(compileFormula("count(A)")({}, rowCtx(columns))).toBe(5);
    expect(compileFormula("median(A)")({}, rowCtx(columns))).toBeCloseTo(3, 12);
    expect(compileFormula("min(A)")({}, rowCtx(columns))).toBe(1);
    expect(compileFormula("max(A)")({}, rowCtx(columns))).toBe(5);
    expect(compileFormula("sd(A)")({}, rowCtx(columns))).toBeCloseTo(Math.sqrt(2.5), 12);
  });

  it("median handles an even-length finite set (average of the two middle values)", () => {
    const columns = { A: [1, 2, 3, 4] };
    expect(compileFormula("median(A)")({}, rowCtx(columns))).toBeCloseTo(2.5, 12);
  });

  it("an all-NaN column: every aggregate is NaN except count(), which is 0", () => {
    const columns = { A: [NaN, NaN, NaN] };
    expect(compileFormula("mean(A)")({}, rowCtx(columns))).toBeNaN();
    expect(compileFormula("sd(A)")({}, rowCtx(columns))).toBeNaN();
    expect(compileFormula("min(A)")({}, rowCtx(columns))).toBeNaN();
    expect(compileFormula("max(A)")({}, rowCtx(columns))).toBeNaN();
    expect(compileFormula("median(A)")({}, rowCtx(columns))).toBeNaN();
    expect(compileFormula("sum(A)")({}, rowCtx(columns))).toBeNaN();
    expect(compileFormula("count(A)")({}, rowCtx(columns))).toBe(0);
  });

  it("sd() of a single finite value is NaN (needs >= 2 for sample sd)", () => {
    const columns = { A: [5, NaN, NaN] };
    expect(compileFormula("sd(A)")({}, rowCtx(columns))).toBeNaN();
  });

  it("aggregates can be combined with arithmetic (a per-row deviation-from-mean)", () => {
    const columns = { A: [1, 2, 3, 4, 5] };
    // row 2 (0-based) has A=3, mean(A)=3 -> deviation 0.
    const ctx = { A: 3 };
    expect(compileFormula("A - mean(A)")(ctx, rowCtx(columns))).toBeCloseTo(0, 12);
  });

  it("aggregate of x (the axis column) is legal, same as any channel", () => {
    const columns = { x: [10, 20, 30] };
    expect(compileFormula("mean(x)")({}, { row: 0, rowCount: 3, columns })).toBe(20);
  });

  it("requires a row context at evaluation time", () => {
    expect(() => compileFormula("mean(A)")({})).toThrow(/row context/);
  });

  it("requires a bare column argument — rejects expressions and wrong arity", () => {
    expect(() => compileFormula("mean(A + 1)")).toThrow(/bare column/);
    expect(() => compileFormula("mean(A, B)")).toThrow(/bare column/);
    expect(() => compileFormula("sd(2 * A)")).toThrow(/bare column/);
    expect(() => compileFormula("mean(sin(A))")).toThrow(/bare column/);
  });

  it("errors on an unknown column referenced by an aggregate", () => {
    expect(() => compileFormula("mean(Z)")({}, rowCtx({ A: [1] }))).toThrow(/unknown variable "Z"/);
  });
});

describe("compileFormula — min/max dual meaning (elementwise vs aggregate)", () => {
  it("keeps the 2-arg elementwise (row-wise) meaning unchanged", () => {
    expect(ev("max(A, B)", { A: 2, B: 7 })).toBe(7);
    expect(ev("min(A, B)", { A: 2, B: 7 })).toBe(2);
  });

  it("a single NON-bare argument still means elementwise (old single-arg Math.max behavior)", () => {
    expect(ev("max(2 * A)", { A: 5 })).toBe(10);
    expect(ev("min(2 * A)", { A: 5 })).toBe(10);
  });

  it("a single BARE column argument means the aggregate over the column", () => {
    const columns = { A: [3, 1, 4, 1, 5] };
    const rowCtx = { row: 0, rowCount: 5, columns };
    expect(compileFormula("max(A)")({}, rowCtx)).toBe(5);
    expect(compileFormula("min(A)")({}, rowCtx)).toBe(1);
  });

  it("integration: applyFormulas gives max(A) the SAME value on every row (scalar-per-column)", () => {
    const ds: DataStruct = {
      time: [0, 1, 2],
      values: [[3], [1], [4]],
      labels: ["A"],
      units: [""],
      metadata: {},
    };
    const out = applyFormulas(ds, [{ name: "M", expr: "max(A)" }]);
    expect(out.values.map((r) => r[1])).toEqual([4, 4, 4]);
  });
});

describe("compileFormula — row()", () => {
  it("is 1-based, matching the worksheet grid's visible row number", () => {
    const columns = { A: [10, 20, 30] };
    expect(compileFormula("row()")({}, { row: 0, rowCount: 3, columns })).toBe(1);
    expect(compileFormula("row()")({}, { row: 2, rowCount: 3, columns })).toBe(3);
  });

  it("takes no arguments", () => {
    expect(() => compileFormula("row(1)")).toThrow(/takes no arguments/);
  });

  it("requires a row context at evaluation time", () => {
    expect(() => compileFormula("row()")({})).toThrow(/row context/);
  });

  it("integration: applyFormulas numbers every row 1..N", () => {
    const ds: DataStruct = {
      time: [0, 1, 2, 3],
      values: [[1], [1], [1], [1]],
      labels: ["A"],
      units: [""],
      metadata: {},
    };
    const out = applyFormulas(ds, [{ name: "R", expr: "row()" }]);
    expect(out.values.map((r) => r[1])).toEqual([1, 2, 3, 4]);
  });
});

describe("compileFormula — lag(A, k) / diff(A)", () => {
  const columns = { A: [10, 20, 30, 40, 50] };
  const at = (row: number) => ({ row, rowCount: columns.A.length, columns });

  it("lag(A, 1) reads the previous row's value, NaN at the start", () => {
    expect(compileFormula("lag(A, 1)")({}, at(0))).toBeNaN();
    expect(compileFormula("lag(A, 1)")({}, at(1))).toBe(10);
    expect(compileFormula("lag(A, 1)")({}, at(4))).toBe(40);
  });

  it("lag(A, k) generalizes to any lookback, NaN once it runs off either edge", () => {
    expect(compileFormula("lag(A, 2)")({}, at(1))).toBeNaN(); // row 1 - 2 = -1
    expect(compileFormula("lag(A, 2)")({}, at(2))).toBe(10);
    expect(compileFormula("lag(A, 0)")({}, at(2))).toBe(30); // k=0 -> current row
    // negative k looks FORWARD ("lead"); still NaN once it runs off the end.
    expect(compileFormula("lag(A, -1)")({}, at(3))).toBe(50);
    expect(compileFormula("lag(A, -1)")({}, at(4))).toBeNaN();
  });

  it("diff(A) is exactly A - lag(A, 1): NaN on the first row, else the step", () => {
    expect(compileFormula("diff(A)")({}, at(0))).toBeNaN();
    expect(compileFormula("diff(A)")({}, at(1))).toBe(10);
    expect(compileFormula("diff(A)")({}, at(4))).toBe(10);
  });

  it("integration: applyFormulas produces the full lag/diff columns, edges included", () => {
    const ds: DataStruct = {
      time: [0, 1, 2, 3, 4],
      values: [[10], [20], [30], [40], [50]],
      labels: ["A"],
      units: [""],
      metadata: {},
    };
    const lag1 = applyFormulas(ds, [{ name: "L", expr: "lag(A, 1)" }]);
    expect(lag1.values.map((r) => r[1])).toEqual([NaN, 10, 20, 30, 40]);

    const diffed = applyFormulas(ds, [{ name: "D", expr: "diff(A)" }]);
    expect(diffed.values.map((r) => r[1])).toEqual([NaN, 10, 10, 10, 10]);

    // A later column may itself feed lag/diff (evaluated in order, same as
    // the existing "reference an earlier computed column" behavior).
    const chained = applyFormulas(ds, [
      { name: "D", expr: "diff(A)" }, // -> column B: [NaN,10,10,10,10]
      { name: "DD", expr: "diff(B)" }, // second difference
    ]);
    expect(chained.values.map((r) => r[2])).toEqual([NaN, NaN, 0, 0, 0]);
  });

  it("requires a bare column argument for lag/diff", () => {
    expect(() => compileFormula("lag(A + 1, 1)")).toThrow(/bare column/);
    expect(() => compileFormula("diff(2 * A)")).toThrow(/bare column/);
    expect(() => compileFormula("lag(sin(A), 1)")).toThrow(/bare column/);
  });

  it("requires a row context at evaluation time", () => {
    expect(() => compileFormula("lag(A, 1)")({})).toThrow(/row context/);
    expect(() => compileFormula("diff(A)")({})).toThrow(/row context/);
  });
});

describe("compileFormula — new-syntax parse errors stay precise", () => {
  it("names the offending operator/function/token, like the existing errors do", () => {
    expect(() => compileFormula("A <")).toThrow();
    expect(() => compileFormula("A < < B")).toThrow();
    expect(() => compileFormula("if(1, 2)")).toThrow(); // missing 3rd arg -> expected ","
    expect(() => compileFormula("=")).toThrow(/unexpected character "="/);
    expect(() => compileFormula("A ! B")).toThrow(/unexpected character "!"/);
  });
});

// ---------------------------------------------------------------------------
// Fuzz / property tests — deterministic (seeded) so they're never flaky, but
// exercise a much wider slice of the grammar than the hand-picked cases
// above. No reflection/eval anywhere in formula.ts, so this is purely a
// robustness + algebraic-identity check on the compiled closures.
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) — fixed seed per test so failures
 *  reproduce exactly and CI never flakes on this file. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ARITH_OPS = ["+", "-", "*"] as const;
const CMP_OPS = ["<", "<=", ">", ">=", "==", "!="] as const;

function genArith(rng: () => number, depth: number): string {
  if (depth <= 0 || rng() < 0.35) {
    const r = rng();
    if (r < 0.34) return "A";
    if (r < 0.68) return "B";
    return String(Math.floor(rng() * 20) - 10);
  }
  const op = ARITH_OPS[Math.floor(rng() * ARITH_OPS.length)];
  return `(${genArith(rng, depth - 1)} ${op} ${genArith(rng, depth - 1)})`;
}
function genCmp(rng: () => number, depth: number): string {
  const op = CMP_OPS[Math.floor(rng() * CMP_OPS.length)];
  return `${genArith(rng, depth)} ${op} ${genArith(rng, depth)}`;
}

describe("fuzz — random comparison/logical expressions (seeded, deterministic)", () => {
  it("not(not(E)) === E for finite operands (200 random cases)", () => {
    const rng = mulberry32(20260728);
    for (let i = 0; i < 200; i++) {
      const expr = genCmp(rng, 3);
      const ctx = { A: rng() * 40 - 20, B: rng() * 40 - 20 };
      const v = ev(expr, ctx);
      const nn = ev(`not not (${expr})`, ctx);
      expect(nn).toBe(v);
    }
  });

  it("De Morgan's law holds for random comparison pairs (150 random cases)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 150; i++) {
      const e1 = genCmp(rng, 2);
      const e2 = genCmp(rng, 2);
      const ctx = { A: rng() * 20 - 10, B: rng() * 20 - 10 };
      const lhs = ev(`not ((${e1}) and (${e2}))`, ctx);
      const rhs = ev(`(not (${e1})) or (not (${e2}))`, ctx);
      expect(lhs).toBe(rhs);
    }
  });

  it("random arithmetic/comparison/logical expressions always compile and evaluate to a finite number (300 cases)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 300; i++) {
      const expr = rng() < 0.5 ? genCmp(rng, 3) : `not (${genCmp(rng, 2)})`;
      const ctx = { A: rng() * 100 - 50, B: rng() * 100 - 50 };
      const v = ev(expr, ctx);
      expect(typeof v).toBe("number");
      expect(Number.isNaN(v)).toBe(false); // finite operands -> never NaN here
      expect(v === 0 || v === 1).toBe(true); // every generated expr is boolean-shaped
    }
  });
});

// ---------------------------------------------------------------------------
// K1 — referencedColumns: a static pass over the SAME grammar compileFormula
// parses, reusing its onRef collection hook (LIBRARY_WORKBOOK_UX_PLAN PR K).
// ---------------------------------------------------------------------------

describe("referencedColumns", () => {
  it("collects bare arithmetic/logical/comparison references, deduped, first-seen order", () => {
    expect(referencedColumns("A + B")).toEqual({ letters: ["A", "B"], valid: true });
    expect(referencedColumns("A + A + B")).toEqual({ letters: ["A", "B"], valid: true }); // deduped
    expect(referencedColumns("(A > 0 and B < 5) or not C")).toEqual({
      letters: ["A", "B", "C"],
      valid: true,
    });
  });

  it("includes x (the time column) like any other bare reference", () => {
    expect(referencedColumns("x * 2 + A")).toEqual({ letters: ["x", "A"], valid: true });
  });

  it("excludes constants, function names, and keywords", () => {
    expect(referencedColumns("pi * sin(A) + e")).toEqual({ letters: ["A"], valid: true });
    expect(referencedColumns("A and B or not A")).toEqual({ letters: ["A", "B"], valid: true });
  });

  it("collects both branches of if(), even though only one runs at eval time", () => {
    expect(referencedColumns("if(A > 0, B, C)")).toEqual({ letters: ["A", "B", "C"], valid: true });
  });

  it("collects row-aware bare-column arguments (lag/diff/aggregates), including the second lag arg", () => {
    expect(referencedColumns("lag(A, B)")).toEqual({ letters: ["A", "B"], valid: true });
    expect(referencedColumns("diff(A) + mean(B)")).toEqual({ letters: ["A", "B"], valid: true });
    expect(referencedColumns("max(A)")).toEqual({ letters: ["A"], valid: true }); // aggregate form, not elementwise
  });

  it("min/max elementwise form still reports every operand", () => {
    expect(referencedColumns("min(A, B, C)")).toEqual({ letters: ["A", "B", "C"], valid: true });
  });

  it("row() references no column", () => {
    expect(referencedColumns("row() + 1")).toEqual({ letters: [], valid: true });
  });

  it("a syntax error reports valid: false with no letters", () => {
    expect(referencedColumns("A +")).toEqual({ letters: [], valid: false });
    expect(referencedColumns("lag(A + 1, 1)")).toEqual({ letters: [], valid: false }); // not a bare column
    expect(referencedColumns("nonsense(A)")).toEqual({ letters: [], valid: false }); // unknown function
  });

  // Property-style agreement (red-first requirement): for every expression
  // below, the letters referencedColumns reports must be EXACTLY the set of
  // context/columns keys the compiled evaluator actually reads when run
  // across enough rows to take every branch (if() only reads one branch's
  // variables per row, so multiple rows with different cond signs are
  // needed to exercise both). Reused compileFormula's onRef hook by
  // construction — this test is the guardrail against the two ever
  // silently diverging.
  it("agrees with eval-time context/columns access, for a representative set of expressions", () => {
    const exprs = [
      "A + B",
      "x * 2 - C",
      "if(A > 0, B, C)",
      "if(A > 0 and B < 5, sin(x), C)",
      "lag(A, 1) + diff(B)",
      "mean(A) + max(B, C)",
      "not (A > 0) or B == C",
    ];
    for (const expr of exprs) {
      const { letters, valid } = referencedColumns(expr);
      expect(valid).toBe(true);
      const fn = compileFormula(expr);
      const accessed = new Set<string>();
      const columnNames = ["x", "A", "B", "C"];
      const rawColumns: Record<string, number[]> = {};
      for (const name of columnNames) rawColumns[name] = [1, -1, 2, -2, 0.5];
      const trackedColumns = new Proxy(rawColumns, {
        get(target, prop: string) {
          accessed.add(prop);
          return target[prop];
        },
      });
      // Enough rows, with alternating-sign values, to take BOTH sides of
      // every if() in the expr set above at least once.
      for (let row = 0; row < rawColumns.A.length; row++) {
        const rawCtx: Record<string, number> = {};
        for (const name of columnNames) rawCtx[name] = rawColumns[name][row];
        const trackedCtx = new Proxy(rawCtx, {
          get(target, prop: string) {
            accessed.add(prop);
            return target[prop];
          },
        });
        fn(trackedCtx, { row, rowCount: rawColumns.A.length, columns: trackedColumns });
      }
      expect([...letters].sort(), `letters vs accessed for "${expr}"`).toEqual([...accessed].sort());
    }
  });
});

// ---------------------------------------------------------------------------
// K5b — per-column formula error state: a compile/eval failure yields the
// NaN column PLUS a visible error, instead of failing silently.
// ---------------------------------------------------------------------------

describe("formulaErrors", () => {
  it("is empty when every formula compiles and evaluates cleanly", () => {
    expect(formulaErrors(base, [{ name: "S", expr: "A + B" }])).toEqual({});
  });

  it("records a compile failure, keyed by column name, alongside the NaN column", () => {
    const formulas: ComputedColumn[] = [{ name: "bad", expr: "A +" }];
    const data = applyFormulas(base, formulas);
    const errs = formulaErrors(base, formulas);
    expect(data.values.every((row) => Number.isNaN(row[row.length - 1]))).toBe(true); // unchanged NaN behavior
    expect(Object.keys(errs)).toEqual(["bad"]);
    expect(errs.bad).toMatch(/./); // some human-readable message
  });

  it("records an eval-time failure (unknown variable reached at run time)", () => {
    // "Z" isn't a real column of `base` (only A/B exist) — this compiles
    // fine but throws "unknown variable" on every row's evaluation.
    const formulas: ComputedColumn[] = [{ name: "bogus", expr: "Z + 1" }];
    const errs = formulaErrors(base, formulas);
    expect(Object.keys(errs)).toEqual(["bogus"]);
    expect(errs.bogus).toMatch(/unknown variable/);
  });

  it("a later clean formula doesn't mask an earlier one's error", () => {
    const formulas: ComputedColumn[] = [
      { name: "bad", expr: "A +" },
      { name: "good", expr: "A + B" },
    ];
    expect(Object.keys(formulaErrors(base, formulas))).toEqual(["bad"]);
  });

  it("recomputeWithErrors derives data + errors from the SAME pass as applyFormulas/formulaErrors on the stripped base", () => {
    const formulas: ComputedColumn[] = [{ name: "bad", expr: "A +" }];
    const strippedBase = baseColumns(base, formulas.length);
    const withErrors = recomputeWithErrors(asAlreadyComputed(base), formulas);
    expect(withErrors.data).toEqual(applyFormulas(strippedBase, formulas));
    expect(withErrors.errors).toEqual(formulaErrors(strippedBase, formulas));
  });
});

// J2 Recode workshop / P1.4: a `ComputedColumn.recode` entry computes via the
// recode recipe instead of compiling `expr` — see lib/recode.ts.
describe("computeFormulas — recode columns (J2)", () => {
  const cat: DataStruct = {
    time: [1, 2, 3, 4],
    values: [[0], [1], [2], [1]],
    labels: ["Grade"],
    units: [""],
    metadata: {},
    cat_levels: { 0: ["Pass", "OK", "Fail"] },
  };

  it("appends a recoded column with its own cat_levels entry, never touching the source", () => {
    const formulas: ComputedColumn[] = [
      {
        name: "GradeGroup",
        expr: "",
        recode: { sourceLetter: "A", mapping: { groups: [{ newLabel: "Pass", from: ["Pass", "OK"] }] } },
      },
    ];
    const out = applyFormulas(cat, formulas);
    expect(out.labels).toEqual(["Grade", "GradeGroup"]);
    // source column (channel 0) is byte-identical — raw stays immutable.
    expect(out.values.map((r) => r[0])).toEqual([0, 1, 2, 1]);
    // Pass(0) and OK(1) both fold onto the SAME new code; Fail(2) keeps its own.
    expect(out.values.map((r) => r[1])).toEqual([0, 0, 1, 0]);
    expect(out.cat_levels?.[1]).toEqual(["Pass", "Fail"]);
    // the source's own level table survives untouched alongside the new one.
    expect(out.cat_levels?.[0]).toEqual(["Pass", "OK", "Fail"]);
  });

  it("records a formula error (not a throw) when the named source isn't categorical", () => {
    const plain: DataStruct = { time: [1, 2], values: [[5], [6]], labels: ["X"], units: [""], metadata: {} };
    const formulas: ComputedColumn[] = [
      { name: "R", expr: "", recode: { sourceLetter: "A", mapping: { groups: [] } } },
    ];
    const errs = formulaErrors(plain, formulas);
    expect(errs.R).toMatch(/not categorical/);
    // column count stays stable even on failure (matches the plain-formula-failure contract).
    expect(applyFormulas(plain, formulas).labels).toEqual(["X", "R"]);
  });

  it("a later column may recode ANOTHER recode column (chains through cat_levels)", () => {
    const formulas: ComputedColumn[] = [
      {
        name: "Coarse",
        expr: "",
        recode: { sourceLetter: "A", mapping: { groups: [{ newLabel: "Pass", from: ["Pass", "OK"] }] } },
      },
      {
        name: "Binary",
        expr: "",
        recode: { sourceLetter: "B", mapping: { groups: [{ newLabel: "Not Pass", from: ["Fail"] }] } },
      },
    ];
    const out = applyFormulas(cat, formulas);
    expect(out.cat_levels?.[2]).toEqual(["Pass", "Not Pass"]);
    expect(out.values.map((r) => r[2])).toEqual([0, 0, 1, 0]);
  });
});
