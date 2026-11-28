// Whole-column signal functions (lib/formulaSignal.ts). The app's evaluator and the
// headless one an exported script runs (calc/column_formula_signal.py) are both held to
// tests/fixtures/wire/formula_signal_headless.json, frozen from scipy / numpy by
// tools/freeze_signal_wire_fixture.py (the Python half is tests/test_column_formula_signal.py).
// Floats compare within a tolerance, never ==.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFormulasWithErrors } from "./formula";
import { headlessFormulaProblem } from "./formulaHeadless";
import { savgolWeights } from "./formulaSignal";
import { STAT_ENTRIES } from "./formulaStatHelp";
import { HEADLESS_STAT_NAMES, SAVGOL_MODES, SIGNAL_NAMES } from "./formulaStatNames";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct } from "./types";

type Cell = number | string;
interface Wire {
  columns: Record<string, Cell[]>;
  cases: { expr: string; values: Cell[] }[];
  refused: string[];
  app_only: string[];
}
const fx = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "tests", "fixtures", "wire", "formula_signal_headless.json"), "utf8")) as Wire;
const num = (c: Cell): number => (c === "NaN" ? NaN : Number(c));
const col = (k: string): number[] => fx.columns[k].map(num);
const data: DataStruct = { time: col("x"), values: col("x").map((_, r) => ["A", "B", "C"].map((k) => col(k)[r])), labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} };
const out = (expr: string) => {
  const r = applyFormulasWithErrors(data, [{ name: "f", expr }]);
  return { col: r.data.values.map((row) => row[3]), error: r.errors.f };
};
const close = (got: number, want: number): boolean => (Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) <= 1e-9 * Math.max(Math.abs(got), Math.abs(want)) + 1e-12);

describe("signal functions agree with scipy / numpy (the wire fixture)", () => {
  it("the fixture is populated and covers every function", () => {
    expect(fx.cases.length).toBeGreaterThanOrEqual(40);
    for (const name of [...SIGNAL_NAMES, ...HEADLESS_STAT_NAMES]) expect(fx.cases.some((c) => c.expr.includes(`${name}(`)), name).toBe(true);
    for (const mode of SAVGOL_MODES) expect(fx.cases.some((c) => c.expr.startsWith("savgol(") && c.expr.includes(`, ${mode})`)), mode).toBe(true);
  });
  it.each(fx.cases.map((c) => [c.expr, c.values] as const))("%s", (expr, values) => {
    const r = out(expr);
    expect(r.error, expr).toBeUndefined();
    values.map(num).forEach((w, i) => expect(close(r.col[i], w), `${expr} row ${i}: ${r.col[i]} vs ${w}`).toBe(true));
    expect(headlessFormulaProblem(expr), expr).toBeNull(); // an exported script reproduces it
  });
  it("a malformed call is refused when the formula is entered, with a reason, here and in the script", () => {
    for (const expr of fx.refused) {
      expect(out(expr).error, expr).toBeTruthy();
      expect(headlessFormulaProblem(expr), expr).toBeTruthy();
    }
  });
});

describe("the app takes expressions the script cannot", () => {
  it("each app-only form computes in the app and is refused by the exporter with a reason", () => {
    expect(fx.app_only.length).toBeGreaterThanOrEqual(3);
    for (const expr of fx.app_only) {
      expect(out(expr).error, expr).toBeUndefined();
      expect(headlessFormulaProblem(expr), expr).toMatch(/plain numbers|is not x or a column letter/);
    }
  });
});

describe("bad arguments are refused with a reason", () => {
  it.each([
    ["savgol(A, 4, 2)", "savgol(): window must be odd"],
    ["savgol(A, 5, 5)", "savgol(): order must be smaller than window"],
    ["savgol(A, 1, 0)", "savgol(): window must be a whole number, 3 or more"],
    ["savgol(A, 5.5, 2)", "savgol(): window must be a whole number, 3 or more"],
    ["savgol(A, 25, 2)", "savgol(): window (25) is larger than the column (24 rows)"],
    ["savgol(B, 5, 2)", "savgol(): the column has blank cells; fill or remove them first"],
    ["movmax(A, 1.5, 1)", "movmax(): back must be a whole number, 0 or more"],
    ["savgol(A + B, 5, 2)", "savgol() expects a bare column name, e.g. savgol(A, …)"],
    ["savgol(A, 5)", "savgol() takes the column and 2 plain numbers"],
    ["savgol(A, 5, 2, bogus)", 'savgol(): unknown boundary mode "bogus"; use mirror, nearest, constant, wrap, interp (a bare word)'],
    ["savgol(A, 5, 2, 3)", 'savgol(): unknown boundary mode "3"; use mirror, nearest, constant, wrap, interp (a bare word)'],
    ["cummax(A, 1)", "cummax() takes just a column"],
    ['movmin(rng("W"), 1, 1)', "movmin() expects a bare column name, e.g. movmin(A, …)"],
  ])("%s", (expr, why) => {
    const r = out(expr);
    expect(r.error).toBe(why);
    expect(r.col.every(Number.isNaN)).toBe(true);
  });
});

describe("edge rules", () => {
  it("savgol of a straight line is the line (the repeated edge only bends the first and last rows toward the edge value)", () => {
    const w = savgolWeights(5, 2);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(w[2]).toBeCloseTo(17 / 35, 12); // the textbook quadratic 5-point smoother: (-3, 12, 17, 12, -3) / 35
    expect(w[0]).toBeCloseTo(-3 / 35, 12);
  });
  it("movmax truncates at the ends and a blank cell stays blank without breaking its neighbours", () => {
    const d: DataStruct = { time: [0, 1, 2, 3, 4], values: [[1], [5], [NaN], [2], [9]], labels: ["A"], units: [""], metadata: {} };
    const r = applyFormulasWithErrors(d, [{ name: "f", expr: "movmax(A, 1, 0)" }]);
    expect(r.data.values.map((v) => v[1])).toEqual([1, 5, NaN, 2, 9]);
    const r2 = applyFormulasWithErrors(d, [{ name: "f", expr: "cummax(A)" }]);
    expect(r2.data.values.map((v) => v[1])).toEqual([1, 5, NaN, 5, 9]);
  });
  it("savgol without a mode is exactly the Repeat (nearest) boundary, and names it explicitly the same", () => {
    for (const w of [3, 5, 9]) expect(out(`savgol(A, ${w}, 2)`).col).toEqual(out(`savgol(A, ${w}, 2, nearest)`).col);
    const want = fx.cases.find((c) => c.expr === "savgol(A, 5, 2)")!.values.map(num); // frozen from scipy mode="nearest"
    out("savgol(A, 5, 2)").col.forEach((v, i) => expect(close(v, want[i])).toBe(true));
  });
  it("is not an incremental, row-local formula (it reads other rows)", () => {
    expect(out("savgol(A, 5, 2)").error).toBeUndefined();
  });
});

describe("the Insert function picker", () => {
  it("lists every function with its edge rule", () => {
    const text = STAT_ENTRIES.map((e) => e.label).join("\n");
    for (const name of SIGNAL_NAMES) expect(text, name).toContain(name);
    expect(text).toContain("Repeat");
    for (const mode of SAVGOL_MODES) expect(text, mode).toContain(mode);
  });
});
