// Complex numbers inside a worksheet formula (plan item 33, contract
// plans/COMPLEX_FORMULA_CONTRACT.md C1-C6, C10). The oracle is
// __fixtures__/formulaComplex.json, frozen by tools/freeze_complex_fixture.py
// from Python's cmath (numpy cross-checks), never from this evaluator.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { applyFormulasWithErrors, compileFormula } from "./formula";
import { COMPLEX_RESULT_ERROR } from "./formulaComplexNames";
import { COMPLEX_OPS } from "./formulaComplex";
import { rewriteFormulaExpr } from "./formulaRename";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct } from "./types";

type Cell = number | string;
interface Fixture {
  columns: Record<string, number[]>;
  cases: { expr: string; re: Cell[]; im: Cell[] }[];
  realResult: { expr: string; value: Cell[] }[];
}
const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "formulaComplex.json"), "utf8")) as Fixture;
const num = (c: Cell): number => (c === "NaN" ? NaN : Number(c));

const data = (cols: Record<string, number[]>): DataStruct => ({
  time: cols.x,
  values: cols.x.map((_, r) => [cols.A[r], cols.B[r], cols.C[r]]),
  labels: ["A", "B", "C"],
  units: ["", "", ""],
  metadata: {},
});
const base = data(fx.columns);

const run = (expr: string, d: DataStruct = base) => {
  const { data: out, errors } = applyFormulasWithErrors(d, [{ name: "f", expr }]);
  return { col: out.values.map((r) => r[r.length - 1]), error: errors.f };
};

/** relative 1e-12, absolute 1e-15 (contract C10) */
const close = (got: number, want: number): boolean => (Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) <= 1e-12 * Math.max(Math.abs(got), Math.abs(want)) + 1e-15);

describe("complex oracle (cmath)", () => {
  it("has a case for every function of C5", () => {
    const all = fx.cases.map((c) => c.expr).join("\n");
    for (const name of ["complex", "polar", "re", "real", "im", "imag", "abs", "arg", "angle", "conj", "exp", "log", "log10", "sqrt", "sin", "cos", "tan", "sinh", "cosh", "tanh"]) {
      expect(all, name).toContain(`${name}(`);
    }
    for (const lit of ["2i", "0.5j", "1e3i"]) expect(all).toContain(lit);
  });

  it.each(fx.cases.map((c) => [c.expr, c] as const))("%s", (_expr, c) => {
    const re = run(`re(${c.expr})`);
    const im = run(`im(${c.expr})`);
    expect(re.error, `re(${c.expr})`).toBeUndefined();
    expect(im.error, `im(${c.expr})`).toBeUndefined();
    c.re.forEach((want, r) => expect(close(re.col[r], num(want)), `${c.expr} re row ${r}: ${re.col[r]} vs ${want}`).toBe(true));
    c.im.forEach((want, r) => expect(close(im.col[r], num(want)), `${c.expr} im row ${r}: ${im.col[r]} vs ${want}`).toBe(true));
  });

  it("a complex result with imaginary part exactly 0 writes its real part (C6)", () => {
    for (const c of fx.realResult) {
      const out = run(c.expr);
      expect(out.error, c.expr).toBeUndefined();
      c.value.forEach((want, r) => expect(close(out.col[r], num(want)), `${c.expr} row ${r}`).toBe(true));
    }
  });

  it("exact small integer powers", () => {
    expect(run("re((1 + 2i) ^ 2)").col[0]).toBe(-3);
    expect(run("im((1 + 2i) ^ 2)").col[0]).toBe(4);
    expect(run("re(complex(0, 1) ^ 4)").col[0]).toBe(1);
  });
});

describe("C3: a real formula keeps its result, bit for bit", () => {
  const REAL = ["sqrt(-1)", "log(-1)", "(-8)^(1/3)", "acos(2)", "A / B + C", "A ** C", "-A^2 + A**2", "sqrt(A) + log(B)", "atan2(A, B) + exp(C)", "A // C + A % C", "x / 0", "min(A, B) + max(A, C)", "if(A > 0, A, nan)", "A > B ? A : B", "A and B", "not C", "A == B", "hypot(A, B, C)", "round(A / 3, 2)"];
  const bits = (v: number): string => (Number.isNaN(v) ? "nan" : Object.is(v, -0) ? "-0" : String(v));

  it("a formula with no complex source never touches the complex module (the fast path)", () => {
    const spy = vi.spyOn(COMPLEX_OPS, "op");
    for (const e of REAL) run(e);
    run("A + B * C");
    expect(spy).not.toHaveBeenCalled();
    run("abs(complex(A, B))");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sqrt(-1), log(-1), (-8)^(1/3) and acos(2) stay blank", () => {
    for (const e of ["sqrt(-1)", "log(-1)", "(-8)^(1/3)", "acos(2)"]) {
      expect(run(e).col.every(Number.isNaN), e).toBe(true);
      expect(run(e).error, e).toBeUndefined();
    }
  });

  it("the same formula gives the same bits with a complex value elsewhere in it", () => {
    for (const e of REAL) {
      const plain = run(e);
      // `if(1, e, 0i)` compiles through the complex path and returns the real branch.
      const viaComplex = run(`if(1, ${e}, 0i)`);
      expect(viaComplex.error, e).toBeUndefined();
      expect(viaComplex.col.map(bits), e).toEqual(plain.col.map(bits));
    }
  });

  it("real-only functions on a complex argument: the real part when im is 0, else an error", () => {
    expect(run("atan(complex(A, 0))").col.map((v) => Number(v.toFixed(12)))).toEqual(fx.columns.A.map((a) => Number(Math.atan(a).toFixed(12))));
    expect(run("floor(complex(1.5, 0))").col[0]).toBe(1);
    expect(run("atan(complex(A, B))").error).toBe("atan takes a real number: use re(), im(), abs() or arg() first");
    expect(run("sqrt(-1) + abs(complex(A, B)) * 0").col.every(Number.isNaN)).toBe(true); // sqrt of a REAL -1 is still blank
  });
});

describe("errors and blanks", () => {
  it("a complex result is an error, and the column is blank (C6)", () => {
    const out = run("complex(A, B)");
    expect(out.error).toBe(COMPLEX_RESULT_ERROR);
    expect(out.col.every(Number.isNaN)).toBe(true);
    expect(run("sqrt(complex(-1, 0))").error).toBe(COMPLEX_RESULT_ERROR); // i
    expect(run("2i").error).toBe(COMPLEX_RESULT_ERROR);
  });

  it.each([
    ["complex(A, B) // 2", /^\/\/ takes a real number/],
    ["complex(A, B) % 2", /^% takes a real number/],
    ["complex(A, B) < 2", /^< takes a real number/],
    ["complex(A, B) >= complex(C, x)", /^>= takes a real number/],
    ["complex(A, B) and 1", /^and takes a real number/],
    ["1 or complex(A, B)", /^or takes a real number/],
    ["not complex(A, B)", /^not takes a real number/],
    ["if(complex(A, B), 1, 2)", /^a condition takes a real number/],
    ["complex(A, B) ? 1 : 2", /^a condition takes a real number/],
    ["sin(complex(A, B)) + atan(complex(A, B))", /^atan takes a real number/],
    ["complex(complex(A, B), 1)", /^complex takes a real number/],
    ["max(complex(A, B), 1)", /^max takes a real number/],
  ])("%s", (expr, message) => {
    const out = run(expr);
    expect(out.error).toMatch(message);
    expect(out.col.every(Number.isNaN)).toBe(true);
  });

  it("division by complex zero and 0^w (Re(w) <= 0) are blank, with no error", () => {
    for (const e of ["re(1 / complex(0, 0))", "re(complex(A, B) / 0i)", "re(complex(0, 0) ^ complex(-1, 0))", "re(log(complex(0, 0)))", "abs(1 / (1i - 1i))"]) {
      const out = run(e);
      expect(out.error, e).toBeUndefined();
      expect(out.col.every(Number.isNaN), e).toBe(true);
    }
  });

  it("a blank part gives a blank cell, never an error", () => {
    const blank = data({ x: [1, 2], A: [Number.NaN, 1], B: [1, Number.NaN], C: [0, 0] });
    expect(run("complex(A, B)", blank)).toEqual({ col: [NaN, NaN], error: undefined });
    expect(run("complex(A, B) * 2 + 1i", blank).error).toBeUndefined();
    expect(run("atan(complex(A, B))", blank).error).toBeUndefined();
    expect(run("im(complex(A, B))", blank).col.map((v) => (Number.isNaN(v) ? "nan" : v))).toEqual([1, "nan"]);
    expect(run("complex(A, B) == complex(A, B)", blank).col.every(Number.isNaN)).toBe(true);
  });
});

describe("syntax", () => {
  it("an imaginary literal is a number straight followed by i or j, standing alone (C2)", () => {
    for (const bad of ["2in", "2 i", "2i3", "2ix", "A2i + 1", "i", "2*i"]) {
      const out = run(bad);
      expect(out.error, bad).toBeTruthy();
      expect(out.error, bad).not.toBe(COMPLEX_RESULT_ERROR);
    }
    expect(() => compileFormula("2in")).toThrow();
    expect(run("im(2i)").col[0]).toBe(2);
    expect(run("im(2j + 1e-1i)").col[0]).toBeCloseTo(2.1, 12);
    expect(run("im(2i*3)").col[0]).toBe(6);
  });

  it("np.real / np.imag / np.angle / np.conj are accepted", () => {
    expect(run("np.imag(complex(A, B))").col).toEqual(fx.columns.B);
    expect(run("np.real(complex(A, B))").col).toEqual(fx.columns.A);
  });

  it("the part functions on a real number: re(A) is A, im(A) is 0, arg(-1) is pi", () => {
    expect(run("re(A)").col).toEqual(fx.columns.A);
    expect(run("im(A)").col).toEqual([0, 0, 0, 0]);
    expect(run("arg(-1)").col[0]).toBeCloseTo(Math.PI, 15);
    expect(run("conj(A)").col).toEqual(fx.columns.A);
  });

  it("composes with let(), the row range wrapper and neighbours", () => {
    expect(run("let(z, complex(A, B), abs(z) * abs(z))").col.map((v) => Number(v.toFixed(9)))).toEqual(fx.columns.A.map((a, i) => Number((a * a + fx.columns.B[i] ** 2).toFixed(9))));
    const ranged = run("if(row() >= 2 and row() <= 3, abs(complex(A, B)), nan)");
    expect(ranged.error).toBeUndefined();
    expect(ranged.col.map((v) => Number.isNaN(v))).toEqual([true, false, false, true]);
  });
});

describe("column removal", () => {
  it("rewrites the column letters of a formula that has an imaginary literal, and it still evaluates", () => {
    // Column A removed: B becomes A. The literal is re-serialised as the call it stands for.
    const r = rewriteFormulaExpr("abs(2i * B + C)", 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expr).toBe("abs ( complex ( 0 , 2 ) * A + B )");
    const two = data({ x: [1], A: [3], B: [4], C: [0] });
    const shifted: DataStruct = { ...two, values: [[3, 4]], labels: ["A", "B"] };
    expect(run(r.expr, shifted).col[0]).toBeCloseTo(Math.hypot(4, 6), 12); // |2i*3 + 4|
  });
});

describe("help (C11)", () => {
  it("the picker lists every complex name under 'Complex numbers', and the three worked examples", async () => {
    const { COMPLEX_ENTRIES } = await import("./formulaComplexHelp");
    const { COMPLEX_NAMES } = await import("./formulaComplexNames");
    const { FUNCTION_ENTRIES } = await import("./setColumnValues");
    const labels = COMPLEX_ENTRIES.map((e) => e.label).join("\n");
    const listed = (name: string): boolean => new RegExp(String.raw`\b${name}\b`).test(labels);
    for (const name of COMPLEX_NAMES) expect(listed(name), name).toBe(true);
    for (const f of ["exp", "log", "log10", "sqrt", "sin", "cos", "tan", "sinh", "cosh", "tanh"]) expect(listed(f), f).toBe(true);
    for (const entry of COMPLEX_ENTRIES) {
      expect(entry.label.startsWith("Complex numbers")).toBe(true);
      expect(FUNCTION_ENTRIES).toContain(entry);
    }
    const examples = COMPLEX_ENTRIES.filter((e) => e.label.includes("example"));
    expect(examples.map((e) => e.text)).toEqual(["abs(complex(B, C))", "degrees(arg(complex(B, C)))", "abs(1 / (1 + 2i*pi*x*1e-3))"]);
    // each inserted text is a formula that evaluates, to the value written out by hand
    const d = data({ x: [1, 2], A: [0, 0], B: [3, 0], C: [4, 5] });
    expect(run(examples[0].text, d).col).toEqual([5, 5]);
    expect(run(examples[1].text, d).col[0]).toBeCloseTo((Math.atan2(4, 3) * 180) / Math.PI, 12);
    expect(run(examples[2].text, d).col[1]).toBeCloseTo(1 / Math.hypot(1, 2 * Math.PI * 2 * 1e-3), 14);
    // every other entry's text compiles (with its cursor marker removed)
    for (const entry of COMPLEX_ENTRIES) expect(() => compileFormula(entry.text.replace("|", "1").replace(", )", ", 1)"))).not.toThrow();
  });
});
