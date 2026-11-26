// lookup / xlookup / match / index / offset (lib/formulaLookup.ts) and the
// element-wise choose, over small tables whose expected values are worked out
// by hand from the Excel definitions the module header cites.

import { describe, expect, it } from "vitest";

import { recomputeWithErrors, applyFormulasWithErrors } from "./formula";
import { asAlreadyComputed, recomputeFromBase } from "./formulaInputs";
import { computeFormulasIncremental, isRowLocalFormula } from "./formulaIncremental";
import { headlessFormulaProblem } from "./formulaHeadless";
import "./formulaRefs"; // registers the lazy extension
import type { ComputedColumn, DataStruct } from "./types";

/** A: ascending keys 10, 20, 20, 40, blank, 60; B: 1..6; C: probes; D: descending keys. */
const A = [10, 20, 20, 40, NaN, 60];
const B = [1, 2, 3, 4, 5, 6];
const C = [5, 10, 15, 20, 45, 100];
const D = [60, 50, 40, 40, 20, 10];
const data = (): DataStruct => ({
  time: A.map((_, i) => i),
  values: A.map((_, r) => [A[r], B[r], C[r], D[r]]),
  labels: ["A", "B", "C", "D"],
  units: ["", "", "", ""],
  metadata: {},
});

function run(expr: string): { out: number[]; error: string | undefined } {
  const { data: out, errors } = applyFormulasWithErrors(data(), [{ name: "out", expr }]);
  return { out: out.values.map((r) => r[4]), error: errors.out };
}
const col = (expr: string): number[] => {
  const r = run(expr);
  expect(r.error, expr).toBeUndefined();
  return r.out;
};

describe("lookup(v, X, Y)", () => {
  it("returns Y at the last row whose X is at most v", () => {
    // probes 5, 10, 15, 20, 45, 100 against keys 10, 20, 20, 40, (blank), 60
    expect(col("lookup(C, A, B)")).toEqual([NaN, 1, 1, 3, 4, 6]);
  });
  it("is blank below every key, and a blank probe stays blank", () => {
    expect(run("lookup(C - 100, A, B)").out.every(Number.isNaN)).toBe(true);
    expect(col("lookup(nan, A, B)").every(Number.isNaN)).toBe(true);
  });
  it("refuses an unsorted key column and says what to use", () => {
    expect(run("lookup(C, D, B)").error).toMatch(/must be sorted ascending.*xlookup/);
  });
  it("takes a constant or any expression as the probe", () => {
    expect(col("lookup(25, A, B)")).toEqual([3, 3, 3, 3, 3, 3]);
    expect(col("lookup(B * 10, A, B)")).toEqual([1, 3, 3, 4, 4, 6]);
  });
});

describe("xlookup(v, X, Y[, notfound])", () => {
  it("matches exactly, first hit, any order", () => {
    expect(col("xlookup(C, A, B)")).toEqual([NaN, 1, NaN, 2, NaN, NaN]);
    expect(col("xlookup(40, D, B)")).toEqual([3, 3, 3, 3, 3, 3]); // first of the two 40s
  });
  it("gives notfound where nothing matches", () => {
    expect(col("xlookup(C, A, B, -1)")).toEqual([-1, 1, -1, 2, -1, -1]);
  });
  it("a blank in the key column never matches a blank probe", () => {
    expect(col("xlookup(nan, A, B, -1)").every((v) => v === -1)).toBe(true);
  });
});

describe("match(v, X[, type])", () => {
  it("type 1 (default): the row of the last X at most v", () => {
    expect(col("match(C, A)")).toEqual([NaN, 1, 1, 3, 4, 6]);
    expect(col("match(C, A, 1)")).toEqual(col("match(C, A)"));
  });
  it("type 0: the first exact match", () => {
    expect(col("match(C, A, 0)")).toEqual([NaN, 1, NaN, 2, NaN, NaN]);
  });
  it("type -1: the last X at least v in a descending column", () => {
    // D = 60, 50, 40, 40, 20, 10; probes 5, 10, 15, 20, 45, 100
    expect(col("match(C, D, -1)")).toEqual([6, 6, 5, 5, 2, NaN]);
  });
  it("refuses a type other than 1, 0, -1", () => {
    expect(run("match(C, A, 2)").error).toMatch(/type must be/);
  });
  it("refuses a column that is not sorted for the type", () => {
    expect(run("match(C, D)").error).toMatch(/ascending/);
    expect(run("match(C, A, -1)").error).toMatch(/descending/);
  });
});

describe("index(Y, k) and offset(A, k)", () => {
  it("index is the function form of Y[k] (1-based, blank out of range)", () => {
    expect(col("index(B, 3)")).toEqual([3, 3, 3, 3, 3, 3]);
    expect(col("index(B, row())")).toEqual(B);
    expect(col("index(B, 0)").every(Number.isNaN)).toBe(true);
    expect(col("index(B, 7)").every(Number.isNaN)).toBe(true);
    expect(col("index(B, 1.5)").every(Number.isNaN)).toBe(true);
    expect(col("index(B, row())")).toEqual(col("B[row()]"));
  });
  it("offset reads this row plus k (negative looks back)", () => {
    expect(col("offset(B, 1)")).toEqual([2, 3, 4, 5, 6, NaN]);
    expect(col("offset(B, -2)")).toEqual([NaN, NaN, 1, 2, 3, 4]);
    expect(col("offset(B, 0)")).toEqual(B);
    expect(col("offset(B, -1)")).toEqual(col("lag(B, 1)"));
  });
  it("pairs with match as Excel INDEX/MATCH does", () => {
    expect(col("index(B, match(C, A, 0))")).toEqual([NaN, 1, NaN, 2, NaN, NaN]);
  });
  it("a column that does not exist is an error", () => {
    expect(run("index(Z, 1)").error).toMatch(/unknown variable "Z"/);
  });
});

describe("column arguments", () => {
  const bad = (expr: string): string | undefined => run(expr).error;
  it("needs bare column letters for the tables", () => {
    expect(bad("lookup(1, A + 1, B)")).toMatch(/bare column/);
    expect(bad("offset(1, 1)")).toMatch(/bare column/);
  });
});

describe("choose(k, a, b, …)", () => {
  it("picks the k-th value, 1-based, k truncated", () => {
    expect(col("choose(B, 10, 20, 30)")).toEqual([10, 20, 30, NaN, NaN, NaN]);
    expect(col("choose(2.9, 10, 20, 30)")[0]).toBe(20);
    expect(col("choose(0, 10, 20)")[0]).toBeNaN();
  });
});

describe("recalculation and the exporter", () => {
  const formulas: ComputedColumn[] = [{ name: "E", expr: "lookup(C, A, B)" }];
  it("a table lookup is not row-local (a cell edit recomputes the column); the result follows the edit", () => {
    expect(isRowLocalFormula(formulas[0])).toBe(false);
    expect(isRowLocalFormula({ name: "E", expr: "index(B, 1)" })).toBe(false);
    expect(isRowLocalFormula({ name: "E", expr: "choose(A, 1, 2)" })).toBe(true);
    const before = recomputeFromBase(data(), formulas).data;
    const values = before.values.map((r, i) => (i === 3 ? r.map((v, c) => (c === 0 ? 70 : v)) : r)); // key 40 becomes 70
    const edited = { ...before, values };
    expect(computeFormulasIncremental(asAlreadyComputed(edited), formulas, [3], undefined)).toBeNull();
    const full = recomputeWithErrors(asAlreadyComputed(edited), formulas);
    expect(full.errors.E).toMatch(/sorted ascending/); // 10, 20, 20, 70, blank, 60
  });
  it("are app-only: the exported script says it does not reproduce them", () => {
    for (const expr of ["lookup(C, A, B)", "xlookup(C, A, B)", "match(C, A)", "index(B, 1)", "offset(B, 1)"])
      expect(headlessFormulaProblem(expr), expr).not.toBeNull();
  });
  it("choose is reproduced headless", () => {
    expect(headlessFormulaProblem("choose(A, B, C)")).toBeNull();
  });
});
