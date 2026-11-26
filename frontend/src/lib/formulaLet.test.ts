// let(name, value, …, expr) — lib/formulaLet.ts, the parser's scope hook
// (formulaParser.ts), the tree parser's expansion (derivedExprAst.ts) and the
// incremental / column-removal paths that walk the same references.

import { describe, expect, it } from "vitest";

import { deriveColumns } from "./derivedColumn";
import { parseExpr, printExpr, columnsRead } from "./derivedExprAst";
import { applyFormulasWithErrors, compileFormula, recomputeWithErrors, referencedColumns } from "./formula";
import { headlessFormulaProblem } from "./formulaHeadless";
import { asAlreadyComputed, recomputeFromBase } from "./formulaInputs";
import { computeFormulasIncremental, isRowLocalFormula } from "./formulaIncremental";
import { rewriteFormulaExpr } from "./formulaRename";
import "./formulaRefs"; // registers the lazy extension (let lives in it)
import type { ComputedColumn, DataStruct, Dataset } from "./types";

const table = (cols: number[][]): DataStruct => ({
  time: cols[0].map((_, i) => i),
  values: cols[0].map((_, r) => cols.map((c) => c[r])),
  labels: cols.map((_, k) => "ABCD"[k]),
  units: cols.map(() => ""),
  metadata: {},
});

/** One formula's column (and error) over columns A (5, 6, NaN) and B (1, 2, 3). */
function run(expr: string): { out: number[]; error: string | undefined } {
  const { data, errors } = applyFormulasWithErrors(table([[5, 6, NaN], [1, 2, 3]]), [{ name: "out", expr }]);
  return { out: data.values.map((r) => r[2]), error: errors.out };
}
const one = (expr: string): number => {
  const r = run(expr);
  expect(r.error, expr).toBeUndefined();
  return r.out[0];
};

describe("binding", () => {
  it("binds a value to a name for the final expression", () => {
    expect(run("let(t, A * 2, t + 1)").out).toEqual([11, 13, NaN]);
  });
  it("lets a later value use an earlier name", () => {
    expect(one("let(a, 2, b, a * 3, c, a + b, a * b * c)")).toBe(2 * 6 * 8);
  });
  it("evaluates each row on its own (no value leaks between rows)", () => {
    expect(run("let(t, B, t * t)").out).toEqual([1, 4, 9]);
  });
  it("carries a blank (NaN) cell through without an error", () => {
    const r = run("let(t, A, t * 2)");
    expect(r.error).toBeUndefined();
    expect(r.out[2]).toBeNaN();
  });
  it("works inside larger expressions and as an argument", () => {
    expect(one("1 + let(t, 2, t * t) * 3")).toBe(13);
    expect(one("max(let(t, 2, t), let(u, 5, u))")).toBe(5);
    expect(one("let(t, 2, t) > 1 ? 7 : 8")).toBe(7);
  });
});

describe("shadowing and nesting", () => {
  it("a later binding of the same name hides the earlier one", () => {
    expect(one("let(a, 1, a, a + 1, a)")).toBe(2);
  });
  it("an inner let hides an outer name only inside itself", () => {
    expect(one("let(a, 1, let(a, 2, a) * 10 + a)")).toBe(21);
  });
  it("nested lets see the outer names", () => {
    expect(one("let(a, 2, let(b, a * 3, a + b))")).toBe(8);
    expect(one("let(a, 2, let(b, let(c, a + 1, c * c), b + a))")).toBe(11);
  });
  it("the binding is gone after the call", () => {
    expect(run("let(t, 2, t) + t").error).toMatch(/unknown variable "t"/);
  });
  it("keeps sibling lets apart", () => {
    expect(one("let(t, 2, t) + let(t, 5, t)")).toBe(7);
  });
});

describe("a name used before it is bound", () => {
  it("is an unknown variable, not a silent zero", () => {
    expect(run("let(a, b + 1, b, 2, a)").error).toMatch(/unknown variable "b"/);
  });
  it("a value cannot use its own name", () => {
    expect(run("let(a, a + 1, a)").error).toMatch(/unknown variable "a"/);
  });
  it("a name that is also a column means the column until it is bound", () => {
    // the first B is the column B (= 1); then B is bound to 100 for the last expression
    expect(one("let(a, B + 1, B, 100, a + B)")).toBe(2 + 100);
  });
});

describe("a bound name that collides with a column or constant", () => {
  it("wins inside the call, and the column is back outside it", () => {
    expect(one("let(A, 100, A + 1)")).toBe(101);
    expect(one("let(A, 100, A) + A")).toBe(105);
  });
  it("the value still reads the column (it is bound after)", () => {
    expect(one("let(A, A * 2, A)")).toBe(10);
  });
  it("beats a constant and x", () => {
    expect(one("let(pi, 3, pi)")).toBe(3);
    expect(one("let(e, 2, e * e)")).toBe(4);
    expect(one("let(x, 7, x)")).toBe(7);
  });
  it("is not a column reference: no dependency, nothing to rewrite", () => {
    expect(referencedColumns("let(t, A * 2, t + B)")).toEqual({ letters: ["A", "B"], valid: true });
    expect(referencedColumns("let(A, B, A + A)")).toEqual({ letters: ["B"], valid: true });
    expect(referencedColumns("let(a, A, let(b, a, b))")).toEqual({ letters: ["A"], valid: true });
  });
});

describe("refusals", () => {
  const bad = (expr: string, message: RegExp): void => expect(() => compileFormula(expr), expr).toThrow(message);
  it("needs name/value pairs and a final expression", () => {
    bad("let()", /name, value pairs/);
    bad("let(1, 2, 3)", /name, value pairs/);
    bad("let(a)", /name, value pairs/);
    bad("let(a, 1)", /final expression/);
    bad("let(a, 1, b, 2)", /final expression|unexpected/);
  });
  it("cannot bind an operator word", () => {
    bad("let(and, 1, 2)", /operator/);
  });
  it("a bound name is a number, not a column, for lag / aggregates", () => {
    bad("let(t, A, mean(t))", /bound by let/);
    bad("let(t, A, lag(t, 1))", /bound by let/);
  });
  it("reports an error inside the value or the body", () => {
    bad("let(a, nosuch(1), a)", /unknown function "nosuch"/);
    bad("let(a, 1, a +)", /unexpected/);
  });
});

describe("recalculation", () => {
  const formulas: ComputedColumn[] = [{ name: "D", expr: "let(t, A * 2, u, t + B, u * u)" }];
  const seedData = (): DataStruct => {
    const time = Array.from({ length: 30 }, (_, i) => i);
    const values = time.map((i) => [i * 0.5, i % 5, Math.sin(i)]);
    const base: DataStruct = { time, values, labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} };
    return recomputeFromBase(base, formulas).data;
  };
  it("is row-local, so a cell edit takes the incremental path", () => {
    expect(isRowLocalFormula(formulas[0])).toBe(true);
    expect(isRowLocalFormula({ name: "D", expr: "let(t, 1, t + mean(A))" })).toBe(false); // an aggregate in it is not
  });
  it("incremental recalculation agrees with the full one", () => {
    const before = seedData();
    const values = before.values.map((r, i) => (i === 7 ? r.map((v, c) => (c === 0 ? 999 : v)) : r));
    const edited = { ...before, values };
    const full = recomputeWithErrors(asAlreadyComputed(edited), formulas);
    const inc = computeFormulasIncremental(asAlreadyComputed(edited), formulas, [7], undefined);
    expect(inc).not.toBeNull();
    expect(inc!.data).toEqual(full.data);
    expect(inc!.errors).toEqual(full.errors);
    expect(full.data.values[7][3]).toBe((999 * 2 + (7 % 5)) ** 2);
  });
  it("a later column may use a let column", () => {
    const f2: ComputedColumn[] = [...formulas, { name: "E", expr: "C + 1" }];
    const out = applyFormulasWithErrors(table([[1, 2], [3, 4]]), f2).data;
    expect(out.values.map((r) => r.slice(2))).toEqual([[25, 26], [64, 65]]);
  });
});

describe("column removal rewrites only real references", () => {
  it("shifts the columns a let reads, never its bound names", () => {
    expect(rewriteFormulaExpr("let(t, B * 2, t + C)", 0)).toEqual({ ok: true, expr: "let ( t , A * 2 , t + B )" });
    // a bound name spelled like a column letter is left alone
    expect(rewriteFormulaExpr("let(B, C, B + 1)", 0)).toEqual({ ok: true, expr: "let ( B , B , B + 1 )" });
  });
  it("refuses a removed column read inside a let, but not a bound name spelled like it", () => {
    expect(rewriteFormulaExpr("let(t, A, t)", 0)).toMatchObject({ ok: false });
    expect(rewriteFormulaExpr("let(A, 5, A + 1)", 0)).toEqual({ ok: true, expr: "let(A, 5, A + 1)" });
  });
});

describe("the tree parser (units, error propagation) expands a let", () => {
  const same = (expr: string): void => {
    const printed = printExpr(parseExpr(expr));
    const cols = table([[5, 6, 7], [1, 2, 3]]);
    const val = (e: string): number[] => applyFormulasWithErrors(cols, [{ name: "o", expr: e }]).data.values.map((r) => r[2]);
    expect(val(printed), `${expr} -> ${printed}`).toEqual(val(expr));
  };
  it("prints text that evaluates the same", () => {
    same("let(t, A * 2, t + B)");
    same("let(a, 1, a, a + 1, a)");
    same("let(a, 1, let(a, 2, a) * 10 + a)");
    same("let(A, 100, A) + A");
    same("let(pi, 3, pi * B)");
  });
  it("reads only the columns the formula reads", () => {
    expect([...columnsRead(parseExpr("let(t, A * 2, t + B)"))].sort()).toEqual(["A", "B"]);
    expect([...columnsRead(parseExpr("let(A, B, A + A)"))]).toEqual(["B"]);
  });
  const ds: Dataset = {
    id: "d",
    name: "d",
    data: { time: [1, 2], values: [[300, 10, 0.5], [310, 20, 0.7]], labels: ["T", "R", "dR"], units: ["K", "Ω", "Ω"], metadata: {} },
    errorRoles: [{ channel: 2, target: 1, axis: "y", side: "both" }],
  };
  it("derives the unit of the expanded formula", () => {
    const r = deriveColumns(ds, { name: "P", expr: "let(t, A * B, t / 2)", propagate: false });
    expect(r).toMatchObject({ ok: true, unit: "K·Ω" });
  });
  it("propagates the error through it", () => {
    const r = deriveColumns(ds, { name: "S", expr: "let(g, B * 3, g + 1)", propagate: true });
    expect(r.ok && r.columns).toHaveLength(2);
  });
  it("refuses a unit contradiction inside a binding", () => {
    expect(deriveColumns(ds, { name: "", expr: "let(t, A + B, t)", propagate: false })).toMatchObject({ ok: false });
  });
});

describe("the exported script", () => {
  it("does not reproduce let (app-only), and says why", () => {
    expect(headlessFormulaProblem("let(t, A, t)")).toMatch(/let/);
  });
});
