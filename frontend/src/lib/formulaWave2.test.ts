// Wave-2 element-wise functions (lib/formulaSpecialFns.ts, formulaEngineering.ts,
// and the older erf/erfc/gamma/lgamma) against the scipy/numpy values frozen by
// tools/freeze_extra_fixture.py into __fixtures__/formulaWave2.json —
// tests/test_column_formula_extra.py replays the same grid against the Python
// mirror, so the two languages are pinned to one set of numbers.
//
// TOLERANCE: |got - want| <= rtol * max(|got|, |want|) + atol, per function
// (TOL below). Bessel J/Y are accurate to an ABSOLUTE ~1e-15, so near a zero the
// relative error is large; they carry an atol. digamma likewise near its root.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFormulasWithErrors } from "./formula";
import { headlessFormulaProblem } from "./formulaHeadless";
import "./formulaRefs"; // registers the lazy extension
import { WAVE2_FUNCS } from "./formulaWave2";
import { WAVE2_NAMES } from "./formulaWave2Names";
import { MATH_FUNCS } from "./formulaMath";
import { FUNCTION_ENTRIES } from "./setColumnValues";
import { LOOKUP_NAMES } from "./formulaWave2Names";
import { deriveColumns } from "./derivedColumn";
import type { DataStruct, Dataset } from "./types";

type Cell = number | string;
interface Case {
  expr: string;
  args: Cell[][];
  expected: Cell[];
}

const num = (c: Cell): number => (c === "NaN" ? NaN : c === "Infinity" ? Infinity : c === "-Infinity" ? -Infinity : Number(c));
const cases = (JSON.parse(readFileSync(join(__dirname, "__fixtures__", "formulaWave2.json"), "utf8")) as { cases: Case[] }).cases;

const TOL: Record<string, [number, number]> = {
  erf: [1e-13, 0],
  erfc: [1e-12, 0],
  gamma: [1e-12, 0],
  lgamma: [1e-12, 1e-14],
  erfinv: [1e-12, 0],
  erfcinv: [1e-12, 0],
  beta: [1e-11, 0],
  lbeta: [1e-12, 1e-13],
  digamma: [1e-12, 1e-13],
  besselj: [1e-9, 2e-14],
  bessely: [1e-9, 2e-14],
  sinc: [1e-12, 1e-16], // numpy gives sin(pi) = 1.2e-16 for sinc(1); the true value is 0
  fromdb: [1e-13, 0],
  todb: [1e-13, 0],
  combin: [1e-12, 0],
  permut: [1e-12, 0],
  fact: [1e-13, 0],
  cbrt: [1e-14, 0],
};

function close(got: number, want: number, [rtol, atol]: [number, number]): boolean {
  if (Number.isNaN(want)) return Number.isNaN(got);
  if (!Number.isFinite(want) || !Number.isFinite(got)) return got === want;
  return Math.abs(got - want) <= rtol * Math.max(Math.abs(got), Math.abs(want)) + atol;
}

describe("wave-2 functions vs scipy / numpy", () => {
  it("lists every function the headless export knows", () => {
    expect([...WAVE2_NAMES].sort()).toEqual([...Object.keys(WAVE2_FUNCS), "erf", "erfc", "gamma", "lgamma"].sort());
    expect(Object.keys(MATH_FUNCS)).toEqual(expect.arrayContaining(["erf", "erfc", "gamma", "lgamma"]));
    expect(cases.map((c) => c.expr.slice(0, c.expr.indexOf("("))).sort()).toEqual([...WAVE2_NAMES].sort());
  });

  for (const c of cases) {
    const name = c.expr.slice(0, c.expr.indexOf("("));
    it(`${c.expr} (${c.args.length} args, ${c.expected.length} rows)`, () => {
      const n = c.expected.length;
      const data: DataStruct = {
        time: new Array<number>(n).fill(0),
        values: Array.from({ length: n }, (_, i) => c.args.map((col) => num(col[i]))),
        labels: c.args.map((_, k) => "ABCD"[k]),
        units: c.args.map(() => ""),
        metadata: {},
      };
      const { data: out, errors } = applyFormulasWithErrors(data, [{ name: "out", expr: c.expr }]);
      expect(Object.keys(errors), "no column error").toEqual([]);
      const tol = TOL[name] ?? [1e-15, 0];
      const bad: string[] = [];
      for (let i = 0; i < n; i++) {
        const got = out.values[i][c.args.length];
        const want = num(c.expected[i]);
        if (!close(got, want, tol)) bad.push(`row ${i} args ${JSON.stringify(c.args.map((a) => a[i]))}: got ${got}, want ${want}`);
      }
      expect(bad.slice(0, 8)).toEqual([]);
    });
  }

  it("is in the headless subset (the exported script computes it with the Python twin)", () => {
    for (const name of WAVE2_NAMES) expect(headlessFormulaProblem(`${name}(A, B, C)`), name).toBeNull();
  });

  it("a missing argument is a blank cell, extras are ignored", () => {
    for (const [name, f] of Object.entries(WAVE2_FUNCS)) expect(f(), name).toBeNaN();
    expect(WAVE2_FUNCS.sinc(0.5, 99)).toBeCloseTo(0.6366197723675814, 14);
    expect(WAVE2_FUNCS.heaviside(0)).toBe(0.5);
  });
});

describe("the Insert function picker", () => {
  it("lists let, the lookup family and every wave-2 function", () => {
    const text = FUNCTION_ENTRIES.map((e) => e.label).join(" ");
    for (const name of [...WAVE2_NAMES, ...LOOKUP_NAMES, "let"]) expect(text, name).toContain(name);
  });
});

describe("published reference values", () => {
  const f = WAVE2_FUNCS;
  it("inverse error functions", () => {
    expect(f.erfinv(0.5)).toBeCloseTo(0.4769362762044699, 14); // Abramowitz & Stegun table 7.5
    expect(f.erfcinv(0.5)).toBeCloseTo(0.4769362762044699, 14); // erfc(x) = 1 - erf(x)
    expect(f.erfinv(-0.5)).toBe(-f.erfinv(0.5));
    expect(MATH_FUNCS.erf(f.erfinv(0.123456))).toBeCloseTo(0.123456, 15);
    expect(f.erfinv(1)).toBe(Infinity);
    expect(f.erfinv(1.0000001)).toBeNaN();
  });
  it("beta, digamma", () => {
    expect(f.beta(2, 3)).toBeCloseTo(1 / 12, 15); // Γ(2)Γ(3)/Γ(5)
    expect(f.beta(0.5, 0.5)).toBeCloseTo(Math.PI, 14);
    // Negative arguments: scipy's continuation (gamma reflection)
    expect(f.beta(-0.5, 2)).toBeCloseTo(-4, 13); // Γ(-1/2)Γ(2)/Γ(3/2) = -2√π/(√π/2)
    expect(f.lbeta(-0.5, 2)).toBeCloseTo(Math.log(4), 13);
    expect(f.beta(-1, 2)).toBe(Infinity); // pole in a, Γ(a + b) finite
    expect(f.beta(-1, 1)).toBeCloseTo(-1, 15); // whole-number limit
    expect(f.beta(-1.5, -1.5)).toBe(0); // Γ(a + b) = Γ(-3) pole alone
    expect(f.lbeta(-1.5, -1.5)).toBe(-Infinity);
    expect(f.lbeta(-1, 2)).toBe(Infinity);
    expect(f.digamma(1)).toBeCloseTo(-0.5772156649015329, 14); // -γ
    expect(f.digamma(0.5)).toBeCloseTo(-0.5772156649015329 - 2 * Math.LN2, 14);
    expect(f.digamma(2) - f.digamma(1)).toBeCloseTo(1, 14); // ψ(x+1) = ψ(x) + 1/x
  });
  it("Bessel functions (Abramowitz & Stegun tables 9.1)", () => {
    expect(f.besselj(0, 1)).toBeCloseTo(0.7651976865579666, 14);
    expect(f.besselj(1, 1)).toBeCloseTo(0.4400505857449335, 14);
    expect(f.besselj(0, 2.404825557695773)).toBeCloseTo(0, 14); // first zero
    expect(f.bessely(0, 1)).toBeCloseTo(0.08825696421567697, 14);
    expect(f.bessely(1, 1)).toBeCloseTo(-0.7812128213002887, 14);
    expect(f.besselj(-1, 2)).toBeCloseTo(-f.besselj(1, 2), 15); // J_-n = (-1)^n J_n
    expect(f.besselj(2, -3)).toBeCloseTo(f.besselj(2, 3), 15); // J_n(-x) = (-1)^n J_n(x)
    expect(f.besselj(1, -3)).toBeCloseTo(-f.besselj(1, 3), 15);
    expect(f.besselj(0.5, 1)).toBeNaN(); // integer orders only
    expect(f.bessely(0, 0)).toBe(-Infinity);
    expect(f.bessely(0, -1)).toBeNaN();
    // The Wronskian J_1 Y_0 - J_0 Y_1 = 2 / (pi x), at a point of each method
    for (const x of [0.3, 7, 24, 26, 300]) expect(f.besselj(1, x) * f.bessely(0, x) - f.besselj(0, x) * f.bessely(1, x)).toBeCloseTo(2 / (Math.PI * x), 13);
  });
  it("engineering helpers", () => {
    expect(f.mod(-7, 3)).toBe(2); // Excel MOD(-7, 3)
    expect(f.mod(7, -3)).toBe(-2);
    expect(f.mod(5, 0)).toBeNaN();
    expect(f.fact(10)).toBe(3628800);
    expect(f.combin(52, 5)).toBe(2598960); // poker hands
    expect(f.permut(5, 2)).toBe(20);
    expect(f.gcd(12, 18)).toBe(6);
    expect(f.lcm(4, 6)).toBe(12);
    expect(f.wrap(190, -180, 180)).toBe(-170);
    expect(f.clamp(5, 0, 2)).toBe(2);
    expect(f.clamp(5, 3, 2)).toBeNaN();
    expect(f.todb(10)).toBe(20);
    expect(f.fromdb(-20)).toBeCloseTo(0.1, 15);
    expect(f.choose(2, 10, 20, 30)).toBe(20);
    expect(f.choose(0, 10, 20)).toBeNaN();
    expect(f.ifnan(NaN, 7)).toBe(7);
    expect(f.isnan(NaN)).toBe(1);
    expect(f.between(1, 1, 2)).toBe(1);
  });
});

describe("units in derived columns", () => {
  const ds: Dataset = {
    id: "d",
    name: "d",
    data: { time: [1, 2, 3], values: [[300, 10, 0.5], [310, 20, 0.6], [320, 30, 0.7]], labels: ["T", "R", "n"], units: ["K", "Ω", ""], metadata: {} },
  };
  const unit = (expr: string) => deriveColumns(ds, { name: "o", expr, propagate: false });
  it("keeps the unit through clamp, mod, trunc, index and offset", () => {
    for (const expr of ["clamp(A, 0, 305)", "mod(A, 7)", "trunc(A)", "index(A, 2)", "offset(A, 1)", "ifnan(A, 0)"])
      expect(unit(expr), expr).toMatchObject({ ok: true, unit: "K" });
  });
  it("gives lookup the Y column's unit and match none", () => {
    expect(unit("lookup(300, A, B)")).toMatchObject({ ok: true, unit: "Ω" });
    expect(unit("xlookup(300, A, B)")).toMatchObject({ ok: true, unit: "Ω" });
    expect(unit("match(300, A)")).toMatchObject({ ok: true, unit: "" });
  });
  it("needs a dimensionless argument for erfinv, digamma and the like", () => {
    expect(unit("erfinv(C)")).toMatchObject({ ok: true, unit: "" });
    // as erf(A): a unit on the argument is a note, and the result is dimensionless
    const r = unit("erfinv(A)");
    expect(r.ok && r.notes.join(" ")).toMatch(/argument should be dimensionless/);
  });
  it("is honest when a unit is not worked out", () => {
    const r = unit("besselj(0, C)");
    expect(r.ok && r.notes.join(" ")).toMatch(/unit of besselj\(\) is not defined/);
  });
});
