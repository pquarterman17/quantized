// P2.5 derived-column units: the small explicit unit algebra, its refusals and
// its stated assumptions (lib/derivedUnits.ts).

import { describe, expect, it } from "vitest";

import { parseExpr } from "./derivedExprAst";
import { deriveUnit, type UnitEnv } from "./derivedUnits";

function env(units: Record<string, string>, fitY: Record<string, string> = {}): UnitEnv {
  return { unitOf: (n) => units[n] ?? "", label: (n) => n, fitYUnit: (m) => fitY[m] ?? "" };
}
const unitOf = (expr: string, units: Record<string, string>, fitY?: Record<string, string>) =>
  deriveUnit(parseExpr(expr), env(units, fitY));

describe("products, quotients and powers", () => {
  it.each([
    ["A * B", { A: "V", B: "A" }, "V·A"],
    ["A / B", { A: "emu", B: "g" }, "emu/g"],
    ["A / B", { A: "J", B: "mol K" }, "J/(mol·K)"], // a space multiplies
    ["A / (B * C)", { A: "J", B: "mol", C: "K" }, "J/(mol·K)"],
    ["A**2", { A: "m/s" }, "m²/s²"],
    ["A ^ -1", { A: "K" }, "1/K"],
    ["sqrt(A)", { A: "K" }, "K^0.5"],
    ["sqrt(A * A)", { A: "Oe" }, "Oe"],
    ["A * B / A", { A: "cm^-3", B: "T" }, "T"],
    ["pow(A, 3)", { A: "Å⁻¹" }, "1/Å³"],
    ["2 * A", { A: "mA" }, "mA"],
    ["A * B", { A: "mA", B: "A" }, "mA·A"], // no prefix algebra: honest, unsimplified
    ["A * B", { A: "a.u.", B: "s" }, "a.u.·s"], // opaque text stays one symbol
    ["A * A", { A: "J/mol K" }, "(J/mol K)²"], // ambiguous text is opaque, parenthesized
    ["A / B", { A: "V", B: "V" }, ""],
  ])("%s over %o is %s", (expr, units, want) => {
    const r = unitOf(expr, units);
    expect(r.error).toBeUndefined();
    expect(r.unit).toBe(want);
  });
  it("marks a unit that cancels, or a pure number, as dimensionless", () => {
    expect(unitOf("A / B", { A: "V", B: "V" }).dimensionless).toBe(true);
    expect(unitOf("2 * pi", {}).dimensionless).toBe(true);
  });
  it("a non-constant exponent on a dimensioned base has no fixed unit (unknown, said so)", () => {
    const r = unitOf("A ** B", { A: "m", B: "" });
    expect(r.unit).toBe("");
    expect(r.dimensionless).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/non-constant power/);
  });
  it("refuses an exponent that has a unit", () => {
    expect(unitOf("2 ** A", { A: "s" }).error).toMatch(/exponent .* has a unit/);
  });
});

describe("sums, comparisons and branches need one unit", () => {
  it("refuses mismatched units with both named, and never converts", () => {
    const r = unitOf("A + B", { A: "K", B: "mK" });
    expect(r.error).toMatch(/units differ in "A \+ B": A is K but B is mK — no conversion is done/);
    expect(unitOf("A > B", { A: "K", B: "s" }).error).toMatch(/units differ/);
    expect(unitOf("where(A > 0, A, B)", { A: "K", B: "s" }).error).toMatch(/branches/);
    expect(unitOf("max(A, B)", { A: "K", B: "s" }).error).toMatch(/units differ/);
  });
  it("a constant sub-expression is a plain number too (review finding)", () => {
    for (const e of ["A + sqrt(2)", "A + 10**3", "A + 2^3", "A + exp(1)", "A * sign(-1) + pi"]) {
      expect(unitOf(e, { A: "V" }), e).toEqual({ unit: "V", dimensionless: false, warnings: [] });
    }
  });
  it("accepts equal units, and a literal takes the column's unit", () => {
    expect(unitOf("A - B", { A: "Oe", B: "Oe" }).unit).toBe("Oe");
    expect(unitOf("A + 273.15", { A: "K" }).unit).toBe("K");
    expect(unitOf("(A > 0) * B", { A: "K", B: "V" }).unit).toBe("V");
  });
  it("an operand with no unit is assumed to match — and the assumption is stated", () => {
    const r = unitOf("A + B", { A: "K", B: "" });
    expect(r.unit).toBe("K");
    expect(r.warnings).toEqual(["B has no unit; \"A + B\" assumes it is in K"]);
  });
  it("a product with an unknown factor is unknown, naming the column", () => {
    const r = unitOf("A * B", { A: "K" });
    expect(r.unit).toBe("");
    expect(r.warnings.at(-1)).toBe("the result's unit is unknown (B has no recorded unit)");
  });
});

describe("transcendental functions are dimensionless", () => {
  it("warns (does not refuse) on a dimensioned argument", () => {
    const r = unitOf("log(A)", { A: "Ω" });
    expect(r.dimensionless).toBe(true);
    expect(r.warnings[0]).toMatch(/log\(\) of A \(Ω\): the argument should be dimensionless/);
  });
  it("trig takes radians: rad is fine, deg is called out", () => {
    expect(unitOf("sin(A)", { A: "rad" }).warnings).toEqual([]);
    expect(unitOf("sin(A)", { A: "deg" }).warnings[0]).toMatch(/takes radians but A is in deg/);
  });
  it("exp of a ratio is clean", () => {
    expect(unitOf("exp(-A / B)", { A: "eV", B: "eV" })).toEqual({ unit: "", dimensionless: true, warnings: [] });
  });
});

describe("other forms", () => {
  it("row-aware forms carry their column's unit; count is a number", () => {
    expect(unitOf("A - mean(A)", { A: "V" }).unit).toBe("V");
    expect(unitOf("diff(A) / diff(x)", { A: "V", x: "s" }).unit).toBe("V/s");
    expect(unitOf("count(A)", { A: "V" }).dimensionless).toBe(true);
  });
  it("fitted parameters have no recorded unit; fitval takes the fit's Y unit", () => {
    expect(unitOf('fit("Gaussian", "A")', {}).warnings[0]).toMatch(/fitted parameters carry no recorded unit/);
    expect(unitOf('A - fitval("Gaussian", x)', { A: "counts" }, { Gaussian: "counts" }).unit).toBe("counts");
    expect(unitOf('A - fitval("Gaussian", x)', { A: "counts" }, { Gaussian: "cps" }).error).toMatch(/units differ/);
  });
  it("flags scaling an offset temperature scale", () => {
    const r = unitOf("A * 1.8 + 32", { A: "°C" });
    expect(r.unit).toBe("°C");
    expect(r.warnings[0]).toMatch(/offset temperature scale/);
  });
});
