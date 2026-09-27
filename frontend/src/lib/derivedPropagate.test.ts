// P2.5 defined error propagation (lib/derivedPropagate.ts): first-order,
// uncorrelated. Each case compares the GENERATED σ formula, compiled by the
// real worksheet evaluator, against the textbook closed form.

import { describe, expect, it } from "vitest";

import { parseExpr } from "./derivedExprAst";
import { fitModelExpr } from "./derivedFitModels";
import { PropagationError, propagateSigma } from "./derivedPropagate";
import { compileFormula } from "./formula";
import type { FitRefSnapshot } from "./formulaTypes";

// A ± C, B ± D (C and D are the bound error columns).
const BOTH = [
  { name: "A", sigma: "C" },
  { name: "B", sigma: "D" },
];
const modelExpr = (m: string) => fitModelExpr(m)?.expr;
const sigmaExpr = (expr: string, inputs = BOTH) => propagateSigma(parseExpr(expr), inputs, modelExpr).expr;
const at = { A: 2.5, B: -1.75, C: 0.1, D: 0.04, x: 0.3 };
const sigmaAt = (expr: string, inputs = BOTH, ctx: Record<string, number> = at) => compileFormula(sigmaExpr(expr, inputs))(ctx);

const { A, B, C: sA, D: sB } = at;

describe("analytic cases", () => {
  it.each<[string, number]>([
    ["A + B", Math.hypot(sA, sB)],
    ["A - B", Math.hypot(sA, sB)],
    ["3*A - 2*B", Math.hypot(3 * sA, 2 * sB)],
    ["A * B", Math.hypot(B * sA, A * sB)],
    ["A / B", Math.hypot(sA / B, (A * sB) / B ** 2)],
    ["A**3", Math.abs(3 * A ** 2 * sA)],
    ["A ^ 3", Math.abs(3 * A ** 2 * sA)],
    ["pow(A, 0.5)", Math.abs((0.5 * sA) / Math.sqrt(A))],
    ["A * A", Math.abs(2 * A * sA)], // the same input twice IS correlated, and handled
    ["log(A)", Math.abs(sA / A)],
    ["log10(A)", Math.abs(sA / (A * Math.LN10))],
    ["sqrt(A)", Math.abs(sA / (2 * Math.sqrt(A)))],
    ["exp(A)", Math.abs(Math.exp(A) * sA)],
    ["sin(A)", Math.abs(Math.cos(A) * sA)],
    ["abs(B)", sB],
    ["A**B", Math.hypot(B * A ** (B - 1) * sA, A ** B * Math.log(A) * sB)],
    ["atan2(A, B)", Math.hypot(B * sA, A * sB) / (A ** 2 + B ** 2)],
    ["hypot(A, B)", Math.hypot(A * sA, B * sB) / Math.hypot(A, B)],
    ["where(A > 0, A, -A) * B", Math.hypot(B * sA, A * sB)],
    ["-A / 2 + pi", sA / 2],
  ])("σ(%s)", (expr, want) => {
    expect(sigmaAt(expr)).toBeCloseTo(want, 13);
  });
  it("prints a formula anyone can read", () => {
    expect(sigmaExpr("A * B")).toBe("sqrt((B * C)**2 + (A * D)**2)");
    expect(sigmaExpr("A**2")).toBe("abs(2 * A * C)");
    expect(sigmaExpr("log(A)")).toBe("abs(1 / A * C)");
  });
  it("an input with no bound error is exact: only the others contribute", () => {
    expect(sigmaAt("A * B", [{ name: "A", sigma: "C" }])).toBeCloseTo(Math.abs(B * sA), 14);
    expect(propagateSigma(parseExpr("A * B"), [{ name: "A", sigma: "C" }], modelExpr).used).toEqual([{ name: "A", sigma: "C" }]);
  });
  it("x can carry an error too", () => {
    const ctx = { ...at, E: 0.02 };
    expect(sigmaAt("A * x", [{ name: "x", sigma: "E" }], ctx)).toBeCloseTo(Math.abs(A * 0.02), 14);
  });
});

describe("where the linearization does not exist, the σ says so (NaN / Inf)", () => {
  it("log at 0 and a division by 0 give non-finite σ, even for an exact-looking row", () => {
    expect(sigmaAt("log(A)", BOTH, { ...at, A: 0 })).toBe(Infinity);
    expect(sigmaAt("log(A)", BOTH, { ...at, A: 0, C: 0 })).toBeNaN();
    expect(Number.isFinite(sigmaAt("A / B", BOTH, { ...at, B: 0 }))).toBe(false);
  });
  it("a NaN input or σ propagates as NaN", () => {
    expect(sigmaAt("A * B", BOTH, { ...at, C: NaN })).toBeNaN();
    expect(sigmaAt("A * B", BOTH, { ...at, A: NaN })).toBeNaN();
  });
});

describe("refusals", () => {
  it.each([
    ["lag(A, 1) - A", /lag\(\) \(it couples rows\)/],
    ["A - mean(A)", /mean\(\) \(it couples rows\)/],
    ["diff(A)", /diff\(\)/],
    ["A % 2", /"%"/],
    ["A // 2", /"\/\/"/],
    ["floor(A)", /floor\(\)/],
    ["min(A, B)", /min\(\)/],
    ["(A > 1) * B", /comparison or logical operator/],
  ])("%s", (expr, why) => {
    expect(() => sigmaExpr(expr)).toThrow(PropagationError);
    expect(() => sigmaExpr(expr)).toThrow(why);
  });
  it("refuses a result that does not depend on any input with an error", () => {
    expect(() => sigmaExpr("2 * x + mean(B)", [{ name: "A", sigma: "C" }])).toThrow(/does not depend/);
    expect(() => sigmaExpr("A - A")).toThrow(/does not depend/);
  });
  it("the condition of if/where is exact and may read anything", () => {
    expect(sigmaAt("if(B > 0, A, 2 * A)")).toBeCloseTo(2 * sA, 14); // B < 0 here
    expect(sigmaExpr("if(mean(B) > 0, A, 2 * A)")).toBe("abs(if(mean(B) > 0, 1, 2) * C)");
  });
});

describe("through a fitted model", () => {
  it("fitval() propagates the argument's error through the model's slope (params exact)", () => {
    const g: FitRefSnapshot = { model: "Gaussian", paramNames: ["A", "μ", "σ"], params: [2, 1, 0.5], expr: modelExpr("Gaussian") };
    const printed = sigmaExpr('fitval("Gaussian", A)', [{ name: "A", sigma: "C" }]);
    expect(printed).toContain('fit("Gaussian", "p1")');
    const got = compileFormula(printed)(at, { row: 0, rowCount: 1, columns: {}, fits: [g] });
    const f = (x: number) => 2 * Math.exp(-((x - 1) ** 2) / (2 * 0.25));
    const slope = (f(A + 1e-6) - f(A - 1e-6)) / 2e-6;
    expect(got).toBeCloseTo(Math.abs(slope * sA), 8);
  });
  it("a model without a formula refuses", () => {
    expect(() => sigmaExpr('fitval("Langevin", A)', [{ name: "A", sigma: "C" }])).toThrow(/no formula for that model/);
  });
  it("fit() parameters are constants", () => {
    expect(sigmaExpr('fit("M", "p0") * A**2', [{ name: "A", sigma: "C" }])).toBe('abs(fit("M", "p0") * (2 * A) * C)');
  });
});
