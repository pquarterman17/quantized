// Gap audit 4 (G3): the new formula functions in a worksheet column —
// erf/erfc/gamma/lgamma/round, floor/ceil with digits, seeded rnd()/normal()
// and interp(v, X, Y) — evaluated through the real compile + recompute path,
// and accepted by the derived-column analysis (unit, columns read) that every
// new column goes through. The numerics themselves are pinned against
// numpy/scipy in formulaMath.test.ts.

import { describe, expect, it } from "vitest";

import { deriveColumns } from "./derivedColumn";
import { applyFormulasWithErrors } from "./formula";
import { isRowLocalFormula } from "./formulaIncremental";
import { erf, gamma, randomSeries } from "./formulaMath";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct, Dataset } from "./types";

const base: DataStruct = {
  time: [0, 1, 2, 3, 4],
  values: [
    [0.25, 0, 10],
    [-1.5, 1, 20],
    [2.675, 2, 15],
    [Number.NaN, 3, 5],
    [3.5, 4, 0],
  ],
  labels: ["V", "T", "R"],
  units: ["V", "K", "Ohm"],
  metadata: {},
};

const run = (expr: string, data: DataStruct = base) => {
  const out = applyFormulasWithErrors(data, [{ name: "f", expr }]);
  return { values: out.data.values.map((row) => row[row.length - 1]), error: out.errors.f };
};
const col = (expr: string, data?: DataStruct): number[] => {
  const r = run(expr, data);
  expect(r.error).toBeUndefined();
  return r.values;
};

describe("special functions in a column", () => {
  it("erf / gamma / lgamma / erfc evaluate per row", () => {
    expect(col("erf(A)")).toEqual(base.values.map((r) => erf(r[0])));
    expect(col("gamma(B + 1)")).toEqual([1, 1, 2, 6, 24]);
    expect(col("lgamma(B + 1)")[4]).toBeCloseTo(Math.log(24), 14);
    expect(col("erfc(0) + 0 * B")).toEqual([1, 1, 1, 1, 1]);
    expect(col("gamma(0.5) + 0 * B")[0]).toBe(gamma(0.5));
  });

  it("round / floor / ceil take digits", () => {
    expect(col("round(A, 1)")).toEqual([0.2, -1.5, 2.7, NaN, 3.5]); // 0.25 -> 0.2: half to even
    expect(col("round(A)")).toEqual([0, -2, 3, NaN, 4]);
    expect(col("floor(A, 1)")).toEqual([0.2, -1.5, 2.6, NaN, 3.5]);
    expect(col("ceil(C, -1)")).toEqual([10, 20, 20, 10, 0]);
  });
});

describe("seeded random columns", () => {
  it("rnd(seed) / normal(seed) are RandomState(seed)'s draws, row by row", () => {
    expect(col("rnd(7)")).toEqual(randomSeries("uniform", 7, 5));
    expect(col("5 + 2 * normal(3)")).toEqual(randomSeries("normal", 3, 5).map((g) => 5 + 2 * g));
  });

  it("the same seed gives the same column on every recalculation", () => {
    expect(col("rnd(11)")).toEqual(col("rnd(11)"));
    expect(col("rnd(11)")).not.toEqual(col("rnd(12)"));
  });

  it("refuses an unseeded or badly seeded draw instead of inventing a seed", () => {
    expect(run("rnd()").error).toMatch(/needs a seed/);
    expect(run("normal(1.5)").error).toMatch(/seed must be a whole number/);
    expect(run("normal(-2)").error).toMatch(/seed written as a number/);
    // A per-row seed is no seed: rnd(row()) would be one new stream per row
    // (and O(rows²) to draw). Refused at parse time.
    expect(run("rnd(row())").error).toMatch(/seed written as a number/);
    expect(run("rnd(B)").error).toMatch(/seed written as a number/);
    expect(run("rnd(1, 2)").error).toMatch(/takes one argument/);
  });

  it("stays row-local, so a one-cell edit does not force a full recompute", () => {
    expect(isRowLocalFormula({ name: "f", expr: "A + rnd(1)" })).toBe(true);
    expect(isRowLocalFormula({ name: "f", expr: "interp(x, A, B)" })).toBe(false);
  });
});

describe("interp(v, X, Y)", () => {
  it("looks Y up along X, NaN outside the table", () => {
    // B (T) = 0..4 against C (R): at x + 0.5 halfway between rows; past the end NaN.
    expect(col("interp(x + 0.5, B, C)")).toEqual([15, 17.5, 10, 2.5, NaN]);
  });

  it("fails closed: a missing column, or an unsorted X", () => {
    expect(run("interp(x, Q, C)").error).toBe('unknown variable "Q"');
    expect(run("interp(x, C, B)").error).toMatch(/column C must be strictly increasing/);
    expect(run("interp(x, 2 * B, C)").error).toMatch(/bare column letter/);
  });

  it("an unsorted X is checked once per evaluation, not once per row", () => {
    // Was O(rows²): the refusal was not remembered, so every row rebuilt and
    // re-checked the whole table (20,000 rows took 7 s).
    const n = 20_000;
    const big: DataStruct = { time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [(i * 7919) % n, i]), labels: ["U", "Y"], units: ["", ""], metadata: {} };
    const t0 = performance.now();
    expect(run("interp(x, A, B)", big).error).toMatch(/strictly increasing/);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("the derived-column analysis accepts them", () => {
  const ds = (): Dataset => ({ id: "d", name: "d", data: base });

  it("interp carries the Y column's unit; round keeps its argument's", () => {
    expect(deriveColumns(ds(), { name: "", expr: "interp(B, B, C)", propagate: false })).toMatchObject({ ok: true, unit: "Ohm" });
    expect(deriveColumns(ds(), { name: "", expr: "round(A, 2)", propagate: false })).toMatchObject({ ok: true, unit: "V" });
    expect(deriveColumns(ds(), { name: "", expr: "rnd(4)", propagate: false })).toMatchObject({ ok: true, dimensionless: true });
  });

  it("a column interp names that does not exist is refused, not guessed", () => {
    expect(deriveColumns(ds(), { name: "", expr: "interp(x, B, Z)", propagate: false })).toEqual({ ok: false, error: "there is no column Z" });
  });
});
