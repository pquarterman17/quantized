// P2.5 Python-like worksheet formula syntax (lib/formulaTokenize.ts,
// lib/formula.ts, lib/formulaFitRefs.ts): what was added, what did NOT change,
// and the fitted-value references' evaluation contract.

import { describe, expect, it } from "vitest";

import { applyFormulas, compileFormula, formulaErrors, referencedColumns, tokenize } from "./formula";
import { remapSurvivingFormulas } from "./formulaRename";
import type { FitRefSnapshot, FormulaRowContext } from "./formulaTypes";
import type { ComputedColumn, DataStruct } from "./types";

const ev = (src: string, ctx: Record<string, number> = {}, ex?: FormulaRowContext) => compileFormula(src)(ctx, ex);

describe("Python-like operators", () => {
  it("** follows Python: tighter than a unary sign on its left, looser on its right, right-assoc", () => {
    expect(ev("-2**2")).toBe(-4);
    expect(ev("(-2)**2")).toBe(4);
    expect(ev("2**-1")).toBe(0.5);
    expect(ev("2**3**2")).toBe(512);
    expect(ev("-A**2", { A: 3 })).toBe(-9);
    expect(ev("2*A**2 + 1", { A: 3 })).toBe(19);
  });
  it("leaves ^ exactly as it was (-2^2 is (-2)^2) so saved formulas keep their meaning", () => {
    expect(ev("-2^2")).toBe(4);
    expect(ev("2^3^2")).toBe(512);
  });
  it("// is floor division (Python), % keeps its existing JS sign rule", () => {
    expect(ev("7 // 2")).toBe(3);
    expect(ev("-7 // 2")).toBe(-4);
    expect(ev("-7 % 3")).toBe(-1);
  });
  it("accepts np. / numpy. / math. prefixes and numpy's arc* spellings", () => {
    expect(ev("np.sqrt(16) + math.pi - numpy.pi")).toBe(4);
    expect(ev("np.arcsin(1)")).toBeCloseTo(Math.PI / 2, 15);
    expect(ev("atan2(1, 1)")).toBeCloseTo(Math.PI / 4, 15);
    expect(ev("hypot(3, 4) + sign(-2) + floor(2.7) + ceil(2.1) + log2(8)")).toBe(5 - 1 + 2 + 3 + 3);
    expect(ev("tanh(0) + sinh(0) + cosh(0)")).toBe(1);
  });
  it("where(c, a, b) is if(c, a, b)", () => {
    expect(ev("where(A > 0, A, -A)", { A: -3 })).toBe(3);
    expect(ev("where(A > 0, 1, 2)", { A: NaN })).toBeNaN();
  });
  it("refuses an inherited object key as a function (the tree parser agrees)", () => {
    expect(() => compileFormula("constructor(1)")).toThrow(/unknown function/);
    expect(() => compileFormula("round(1.5)")).toThrow(/unknown function "round"/);
  });
});

describe("tokenizer positions", () => {
  it("records each token's offset and names the column of a bad character", () => {
    expect(tokenize("A **  np.sqrt(B)").map((t) => [t.v, t.p])).toEqual([
      ["A", 0],
      ["**", 2],
      ["sqrt", 6],
      ["(", 13],
      ["B", 14],
      [")", 15],
    ]);
    expect(() => tokenize("A + @")).toThrow('unexpected character "@" (column 5)');
    expect(() => tokenize('fit("Gauss')).toThrow("unterminated text in quotes (column 5)");
  });
  it("a . before a digit is still a number, before a letter the member operator", () => {
    expect(tokenize(".5").map((t) => t.v)).toEqual([0.5]);
    expect(tokenize('fit("M").A').map((t) => t.v)).toEqual(["fit", "(", "M", ")", ".", "A"]);
  });
});

const gauss: FitRefSnapshot = {
  model: "Gaussian",
  paramNames: ["A", "μ", "σ"],
  params: [2, 1, 0.5],
  expr: "p0*exp(-((x - p1)**2)/(2*p2**2))",
};
const rowCtx = (fits: FitRefSnapshot[]): FormulaRowContext => ({ row: 0, rowCount: 1, columns: {}, fits });

describe("fit() / fitval() evaluation (snapshots only)", () => {
  it("reads a fitted parameter by name, by .member, and by p-index", () => {
    expect(ev('fit("Gaussian", "μ")', {}, rowCtx([gauss]))).toBe(1);
    expect(ev('fit("Gaussian").A * 3', {}, rowCtx([gauss]))).toBe(6);
    expect(ev("fit('Gaussian', 'p2')", {}, rowCtx([gauss]))).toBe(0.5);
  });
  it("evaluates the fitted model at an expression", () => {
    const x = 1.3;
    const want = 2 * Math.exp(-((x - 1) ** 2) / (2 * 0.25));
    expect(ev('fitval("Gaussian", A + 0.3)', { A: 1 }, rowCtx([gauss]))).toBeCloseTo(want, 14);
  });
  it("refuses a missing snapshot, a missing fit and an unknown parameter", () => {
    expect(() => ev('fit("Gaussian", "A")', {}, rowCtx([]))).toThrow('fit "Gaussian": not resolved');
    const missing = { ...gauss, params: [], missing: "this dataset has no saved fit" };
    expect(() => ev('fitval("Gaussian", 1)', {}, rowCtx([missing]))).toThrow("this dataset has no saved fit");
    expect(() => ev('fit("Gaussian", "B")', {}, rowCtx([gauss]))).toThrow('has no parameter "B"');
    expect(() => ev('fit("Gaussian", "p9")', {}, rowCtx([gauss]))).toThrow('has no parameter "p9"');
    expect(() => ev('fitval("Linear", 1)', {}, rowCtx([{ model: "Linear", paramNames: [], params: [1, 2] }]))).toThrow("no model formula");
  });
  it("parses only the documented shapes", () => {
    expect(() => compileFormula("fit(Gaussian, A)")).toThrow(/text in quotes/);
    expect(() => compileFormula('fit("Gaussian")')).toThrow(/expected "\."/);
    expect(() => compileFormula('fit("Gaussian").')).toThrow(/bad number/); // "." then no name
    expect(() => compileFormula('"text" + 1')).toThrow(/unexpected token/);
    expect(referencedColumns('fitval("Gaussian", B) * A').letters).toEqual(["B", "A"]);
  });
  it("a computed column reads its own snapshot through applyFormulas, and errors without one", () => {
    const base: DataStruct = { time: [0, 1], values: [[1], [2]], labels: ["T"], units: ["K"], metadata: {} };
    const withFit: ComputedColumn = { name: "g", expr: 'fitval("Gaussian", A)', derived: { fits: [gauss] } };
    expect(applyFormulas(base, [withFit]).values.map((r) => r[1])).toEqual([2, 2 * Math.exp(-1 / 0.5)]);
    const bare: ComputedColumn = { name: "g", expr: 'fitval("Gaussian", A)' };
    expect(formulaErrors(base, [bare]).g).toMatch(/not resolved/);
  });
});

describe("column removal rewrites keep text arguments quoted", () => {
  it("shifts letters inside fitval() and keeps the model text intact", () => {
    const f: ComputedColumn = { name: "g", expr: 'fitval("Gauss \'x\'", C) + fit("M", "p0")' };
    const { formulas, forcedErrors } = remapSurvivingFormulas([f], 0);
    expect(forcedErrors).toEqual({});
    expect(formulas[0].expr).toBe('fitval ( "Gauss \'x\'" , B ) + fit ( "M" , "p0" )');
    expect(compileFormula(formulas[0].expr)).toBeTypeOf("function");
  });
});
