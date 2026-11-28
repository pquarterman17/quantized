// The app's complex evaluator and the headless one an exported script runs
// (calc/column_formula_complex.py) give the same column: both are asserted
// against tests/fixtures/wire/formula_complex_headless.json (frozen from cmath
// and numpy by tools/freeze_complex_wire_fixture.py; tests/test_column_formula_complex.py
// is the Python half). Floats compare within a tolerance, never ==.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFormulas } from "./formula";
import { headlessFormulaProblem } from "./formulaHeadless";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct } from "./types";

type Cell = number | string;
interface Wire {
  columns: Record<string, number[]>;
  cases: { expr: string; values: Cell[] }[];
  refused: string[];
  pairs: { expr: string; re: Cell[]; im: Cell[] }[];
}
const fx = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "tests", "fixtures", "wire", "formula_complex_headless.json"), "utf8")) as Wire;
const num = (c: Cell): number => (c === "NaN" ? NaN : Number(c));
const { x, A, B, C } = fx.columns;
const data: DataStruct = { time: x, values: x.map((_, r) => [A[r], B[r], C[r]]), labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} };
const column = (expr: string): number[] => applyFormulas(data, [{ name: "f", expr }]).values.map((r) => r[3]);
const close = (got: number, want: number): boolean => (Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) <= 1e-12 * Math.max(Math.abs(got), Math.abs(want)) + 1e-15);

describe("complex wire fixture", () => {
  it("every case is in the headless subset and the app computes the same column", () => {
    expect(fx.cases.length).toBeGreaterThan(100);
    for (const c of fx.cases) {
      expect(headlessFormulaProblem(c.expr), c.expr).toBeNull();
      const got = column(c.expr);
      c.values.forEach((want, r) => expect(close(got[r], num(want)), `${c.expr} row ${r}: ${got[r]} vs ${want}`).toBe(true));
    }
  });

  it("comparisons and conditionals stay app-only", () => {
    expect(fx.refused.length).toBeGreaterThan(0);
    for (const e of fx.refused) expect(headlessFormulaProblem(e), e).not.toBeNull();
  });

  it("the re/im pair of one complex expression matches numpy", () => {
    for (const p of fx.pairs) {
      for (const part of ["re", "im"] as const) {
        const got = column(`${part}(${p.expr})`);
        p[part].forEach((want, r) => expect(close(got[r], num(want)), `${part}(${p.expr}) row ${r}`).toBe(true));
      }
    }
  });
});
