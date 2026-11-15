// The formula language's special functions against numpy/scipy (gap audit 4,
// G3). The expected values are __fixtures__/formulaMath.json, which
// tests/test_formula_math_fixture.py recomputes from numpy/scipy and compares,
// so every number below is numpy's or scipy's own answer.

import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/formulaMath.json";
import { FUNCS } from "./formulaFuncs";
import { erf, erfc, gamma, interpAt, interpTable, lgamma, randomSeries, round } from "./formulaMath";

const num = (v: number | string): number => (v === "nan" ? NaN : v === "inf" ? Infinity : v === "-inf" ? -Infinity : Number(v));

/** Relative agreement `rtol`, with an absolute floor `atol` near zero. */
function close(got: number, want: number, rtol: number, atol = 0): boolean {
  if (Number.isNaN(want)) return Number.isNaN(got);
  if (!Number.isFinite(want)) return got === want;
  return Math.abs(got - want) <= atol + rtol * Math.abs(want);
}

function mismatches(xs: readonly number[], f: (v: number) => number, want: readonly (number | string)[], rtol: number, atol = 0): string[] {
  return xs.flatMap((x, i) => (close(f(x), num(want[i]), rtol, atol) ? [] : [`f(${x}) = ${f(x)}, want ${want[i]}`]));
}

describe("special functions agree with scipy.special", () => {
  it("erf and erfc", () => {
    const { x, erf: e, erfc: ec } = fixture.erf;
    expect(mismatches(x, erf, e, 2e-15, 1e-300)).toEqual([]);
    expect(mismatches(x, erfc, ec, 5e-14, 1e-300)).toEqual([]);
  });

  it("gamma, including its poles and overflow", () => {
    const { x, gamma: g } = fixture.gamma;
    expect(mismatches(x, gamma, g, 1e-13)).toEqual([]);
  });

  it("lgamma is scipy's gammaln, log|Γ|", () => {
    const { x, gammaln } = fixture.gamma;
    expect(mismatches(x, lgamma, gammaln, 1e-13, 1e-14)).toEqual([]);
  });
});

describe("round / floor / ceil with digits agree with numpy", () => {
  it("round is numpy.round: halves go to the even neighbour", () => {
    const bad = fixture.round.flatMap(([v, n, want]) => (round(Number(v), Number(n)) === num(want) ? [] : [`round(${v}, ${n}) = ${round(Number(v), Number(n))}, want ${want}`]));
    expect(bad).toEqual([]);
    expect(round(2.5)).toBe(2);
  });

  it("floor and ceil scale the same way", () => {
    for (const [table, f] of [
      [fixture.floor, FUNCS.floor],
      [fixture.ceil, FUNCS.ceil],
    ] as const) {
      const bad = table.flatMap(([v, n, want]) => (f(Number(v), Number(n)) === num(want) ? [] : [`${v}, ${n} -> ${f(Number(v), Number(n))}, want ${want}`]));
      expect(bad).toEqual([]);
    }
    expect(FUNCS.floor(2.7)).toBe(2); // one argument: unchanged
  });

  it("a digits argument that is not a whole number is an error, never rounded", () => {
    expect(() => round(1.234, 1.5)).toThrow(/whole number/);
    expect(() => FUNCS.ceil(1.234, 0.5)).toThrow(/whole number/);
  });
});

describe("seeded random draws are numpy.random.RandomState's", () => {
  const { n, at, ...seeds } = fixture.random;
  it.each(Object.keys(seeds))("seed %s: random_sample and standard_normal", (seed) => {
    const want = seeds[seed as keyof typeof seeds];
    const u = randomSeries("uniform", Number(seed), n);
    const g = randomSeries("normal", Number(seed), n);
    // random_sample is integer arithmetic on the twister's output: exact.
    expect(at.map((i) => u[i])).toEqual(want.uniform.map(num));
    expect(mismatches(at, (i) => g[i], want.normal, 1e-14)).toEqual([]);
  });

  it("refuses a seed RandomState would refuse", () => {
    expect(() => randomSeries("uniform", -1, 3)).toThrow(/seed/);
    expect(() => randomSeries("uniform", 1.5, 3)).toThrow(/seed/);
    expect(() => randomSeries("normal", 2 ** 32, 3)).toThrow(/seed/);
  });
});

describe("interp is numpy.interp with NaN outside the table", () => {
  it("matches np.interp(left=nan, right=nan)", () => {
    const { x, y, at, out } = fixture.interp;
    const t = interpTable(x, y, "A");
    expect(mismatches(at, (v) => interpAt(t, v), out, 1e-15)).toEqual([]);
  });

  it("a decreasing table is the same curve; blank pairs are skipped", () => {
    const { x, y, at, out } = fixture.interp;
    const t = interpTable([NaN, ...[...x].reverse(), 9], [5, ...[...y].reverse(), NaN], "A");
    expect(mismatches(at, (v) => interpAt(t, v), out, 1e-15)).toEqual([]);
  });

  it("an unsorted or repeated X is an error, not a silent answer", () => {
    expect(() => interpTable([0, 2, 1], [1, 2, 3], "A")).toThrow(/column A must be strictly increasing/);
    expect(() => interpTable([0, 1, 1], [1, 2, 3], "A")).toThrow(/strictly/);
  });
});
