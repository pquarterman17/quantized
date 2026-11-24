// Grouped aggregates (lib/formulaGroupAgg.ts, gap audit 9 G4) against pandas
// groupby().transform() reference values frozen by
// tools/freeze_group_agg_fixture.py (pandas 2.3.3). Tolerance: the measured
// worst difference on this fixture is 2.0e-16 relative (summation order);
// asserted here at 1e-12 relative, counts/ranks EXACTLY.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { deriveUnit } from "./derivedUnits";
import { parseExpr } from "./derivedExprAst";
import { applyFormulasWithErrors } from "./formula";
import { headlessFormulaProblem } from "./formulaHeadless";
import { isRowLocalFormula } from "./formulaIncremental";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct } from "./types";

interface Fixture {
  x: (number | null)[];
  b: (number | null)[];
  c: number[];
  expected: Record<"b" | "bc" | "none", Record<string, (number | null)[]>>;
}
const FX = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "formulaGroupAgg.json"), "utf8")) as Fixture;
const nan = (v: number | null) => (v === null ? Number.NaN : v);

const data = (x = FX.x, b = FX.b, c = FX.c): DataStruct => ({
  time: x.map((_, i) => i),
  values: x.map((v, i) => [nan(v), nan(b[i]), c[i]]),
  labels: ["x", "S", "T"],
  units: ["emu", "", ""],
  metadata: {},
});
const run = (expr: string, d = data()): number[] => {
  const out = applyFormulasWithErrors(d, [{ name: "f", expr }]);
  expect(out.errors).toEqual({});
  return out.data.values.map((r) => r[r.length - 1]);
};
const same = (got: number[], want: (number | null)[], exact: boolean, what: string) => {
  expect(got.length).toBe(want.length);
  got.forEach((g, i) => {
    const w = want[i];
    if (w === null) return expect(g, `${what} row ${i + 1}`).toBeNaN();
    if (exact) return expect(g, `${what} row ${i + 1}`).toBe(w);
    expect(Math.abs(g - w), `${what} row ${i + 1}`).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(w)));
  });
};

describe("matches pandas groupby().transform()", () => {
  for (const [tag, args] of [["b", "A, B"], ["bc", "A, B, C"]] as const) {
    for (const [fn, want] of Object.entries(FX.expected[tag])) {
      it(`${fn}(${args})`, () => same(run(`${fn}(${args})`), want, /count|rank/.test(fn), fn));
    }
  }
  it("no by-column = the whole column", () => {
    for (const [fn, want] of Object.entries(FX.expected.none)) same(run(`${fn}(A)`), want, /count|rank/.test(fn), fn);
  });
});

describe("semantics", () => {
  it("a missing by-key gives missing from every function (provisional)", () => {
    for (const fn of ["col_mean", "col_count", "col_rank", "col_score"]) {
      const out = run(`${fn}(A, B)`);
      FX.b.forEach((k, i) => k === null && expect(out[i]).toBeNaN());
    }
  });
  it("rank ties: the four modes on 33, 55, 55, 77 (JMP help example)", () => {
    const d = data([33, 55, 55, 77], [1, 1, 1, 1], [0, 0, 0, 0]);
    expect(run("col_rank(A, B)", d)).toEqual([1, 2, 3, 4]);
    expect(run("col_rank_avg(A, B)", d)).toEqual([1, 2.5, 2.5, 4]);
    expect(run("col_rank_min(A, B)", d)).toEqual([1, 2, 2, 4]);
    expect(run("col_rank_dense(A, B)", d)).toEqual([1, 2, 2, 3]);
  });
  it("reads the same rows as mean(A): excluded/filtered rows are included", () => {
    expect(run("col_mean(A)")).toEqual(run("mean(A)"));
    expect(run("col_sd(A)")).toEqual(run("sd(A)"));
    expect(run("col_count(A)")).toEqual(run("count(A)"));
  });
  it("by-columns of -0 and 0 are one group; a 2-key group is not a 1-key group", () => {
    const d = data([1, 3], [0, -0], [0, 0]);
    expect(run("col_mean(A, B)", d)).toEqual([2, 2]);
  });
  it("composes in formulas", () => {
    const d = data([2, 4, 10, 30], [1, 1, 2, 2], [0, 0, 0, 0]);
    expect(run("A / col_max(A, B)", d)).toEqual([0.5, 1, 1 / 3, 1]);
  });
  it("is non-local, so a one-cell edit recomputes in full", () => {
    expect(isRowLocalFormula({ name: "f", expr: "col_mean(A, B)" })).toBe(false);
  });
});

describe("refusals", () => {
  const err = (expr: string) => applyFormulasWithErrors(data(), [{ name: "f", expr }]).errors.f;
  it("needs bare column names and a column", () => {
    expect(err("col_mean(A + 1, B)")).toMatch(/bare column name/);
    expect(err("col_mean(A, 2 * B)")).toMatch(/bare column name/);
    expect(err("col_mean()")).toBeTruthy();
    expect(err("col_mean(A, Z)")).toMatch(/unknown variable "Z"/);
  });
});

describe("neighbours", () => {
  it("the headless (Python) subset refuses them, so the exporter says NOT REPRODUCED", () => {
    for (const e of ["col_mean(A, B)", "col_rank_dense(A)", "col_score(A, B)"]) expect(headlessFormulaProblem(e), e).toMatch(/calls col_/);
  });
  it("derived units: statistics keep the unit, count/rank are unitless, score is dimensionless", () => {
    const env = { unitOf: (n: string) => (n === "A" ? "emu" : ""), label: (n: string) => n, fitYUnit: () => "" };
    const u = (e: string) => deriveUnit(parseExpr(e), env);
    expect(u("col_mean(A, B)").unit).toBe("emu");
    expect(u("A - col_mean(A, B)").unit).toBe("emu");
    expect(u("col_score(A, B)").dimensionless).toBe(true);
    expect(u("col_rank(A, B)").unit).toBe("");
    expect(u("col_count(A, B)").warnings).toEqual([]);
  });
});
