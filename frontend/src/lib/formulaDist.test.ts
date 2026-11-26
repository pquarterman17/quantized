// Distribution functions (lib/formulaDist.ts + formulaDistNumerics.ts) against
// the scipy.stats values frozen by tools/freeze_dist_fixture.py into
// __fixtures__/formulaDist.json (tests/test_column_formula_dist.py replays the
// same grid against the Python mirror).
//
// TOLERANCES (relative, |got - want| <= rtol * max(|got|, |want|)):
//   densities, cdfs, pmfs   1e-11  (both sides are exact to ~1e-13 on this
//                                   grid: shapes up to 150; the slack is libm
//                                   differences between Node versions)
//   inverses (*inv)         1e-9   (the TS solver converges to 1e-14, scipy's
//                                   boost ppf is exact to ~1e-15; the slack
//                                   absorbs the flat-CDF conditioning at
//                                   p = 1 - 1e-9)
// Values below 1e-300 are compared absolutely.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFormulasWithErrors } from "./formula";
import { DIST_FUNCS } from "./formulaDist";
import { DIST_NAMES } from "./formulaDistNames";
import { headlessFormulaProblem } from "./formulaHeadless";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct } from "./types";

type Cell = number | string;
interface Case {
  expr: string;
  args: Cell[][];
  expected: Cell[];
}

const num = (c: Cell): number => (c === "NaN" ? NaN : c === "Infinity" ? Infinity : c === "-Infinity" ? -Infinity : Number(c));
const cases = (JSON.parse(readFileSync(join(__dirname, "__fixtures__", "formulaDist.json"), "utf8")) as { cases: Case[] }).cases;

function close(got: number, want: number, rtol: number): boolean {
  if (Number.isNaN(want)) return Number.isNaN(got);
  if (!Number.isFinite(want) || !Number.isFinite(got)) return got === want;
  return Math.abs(got - want) <= rtol * Math.max(Math.abs(got), Math.abs(want)) || Math.abs(got - want) < 1e-300;
}

describe("distribution functions vs scipy.stats", () => {
  it("lists every function the headless export knows", () => {
    expect([...DIST_NAMES].sort()).toEqual(Object.keys(DIST_FUNCS).sort());
  });

  for (const c of cases) {
    const name = c.expr.slice(0, c.expr.indexOf("("));
    const rtol = name.endsWith("inv") ? 1e-9 : 1e-11;
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
      const bad: string[] = [];
      for (let i = 0; i < n; i++) {
        const got = out.values[i][c.args.length];
        const want = num(c.expected[i]);
        // A row the app rejects (tail not 1 or 2) is a blank cell, as the mirror's NaN.
        if (!close(got, want, rtol)) bad.push(`row ${i} args ${JSON.stringify(c.args.map((a) => a[i]))}: got ${got}, want ${want}`);
      }
      // Only a row with a tail outside {1, 2} (the app throws for it, the cell is blank) may report an error.
      const tailAt = { normcdf: 2, tcdf: 3, chi2cdf: 3, expcdf: 3, fcdf: 4, gamcdf: 4, betacdf: 4, logncdf: 4, wblcdf: 4 }[name];
      const badTail = c.args.length === tailAt && c.args[tailAt - 1].some((v) => ![1, 2, "NaN"].includes(v));
      if (!badTail) expect(Object.keys(errors), "no column error").toEqual([]);
      expect(bad.slice(0, 8)).toEqual([]);
    });
  }

  it("is in the headless subset (the exported script computes it with the Python twin)", () => {
    for (const name of DIST_NAMES) expect(headlessFormulaProblem(`${name}(A, B, C)`), name).toBeNull();
  });

  it("normcdf tails as measured in Origin 2026b over COM, 2026-11-25", () => {
    // normcdf(1.5) = normcdf(1.5, 2) = 0.93319 (lower); normcdf(1.5, 1) = 0.066807 (upper);
    // normcdf(1.5, 0) gives no value (missing).
    const f = DIST_FUNCS;
    expect(f.normcdf(1.5)).toBeCloseTo(0.93319, 5);
    expect(f.normcdf(1.5, 2)).toBeCloseTo(0.93319, 5);
    expect(f.normcdf(1.5, 1)).toBeCloseTo(0.066807, 6);
    expect(() => f.normcdf(1.5, 0)).toThrow(/tail/); // the cell is blank, never a made-up value
    const { data, errors } = applyFormulasWithErrors(
      { time: [0], values: [[1.5]], labels: ["A"], units: [""], metadata: {} },
      [{ name: "out", expr: "normcdf(A, 0)" }],
    );
    expect(data.values[0][1]).toBeNaN();
    expect(Object.keys(errors)).toEqual(["out"]);
  });

  it("rejects a tail other than 1 or 2 in the cell, not by guessing", () => {
    const f = DIST_FUNCS;
    expect(() => f.normcdf(0, 0)).toThrow(/tail/);
    expect(f.normcdf(0, 1)).toBeCloseTo(0.5, 15);
    expect(f.normcdf(1.96, 2)).toBeCloseTo(0.9750021048517795, 14);
  });

  it("gives textbook values", () => {
    const f = DIST_FUNCS;
    expect(f.norminv(0.975)).toBeCloseTo(1.959963984540054, 13);
    expect(f.tinv(0.975, 10)).toBeCloseTo(2.2281388519862744, 12);
    expect(f.chi2inv(0.95, 1)).toBeCloseTo(3.841458820694124, 11);
    expect(f.binocdf(3, 10, 0.5)).toBeCloseTo(0.171875, 14);
    expect(f.poisspdf(2, 3)).toBeCloseTo(0.22404180765538775, 14);
  });
});
