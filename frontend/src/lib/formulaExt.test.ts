// The Origin-style formula syntax is a LAZY chunk (lib/formulaExt.ts): before
// it loads, a formula that needs it reports an ERROR (never a wrong value);
// a plain formula is unaffected; once it loads, the store recomputes every
// formula that errored.
// Deliberately does NOT import lib/formulaRefs statically.

import { describe, expect, it } from "vitest";

import { applyFormulasWithErrors } from "./formula";
import { EXTENSION_PENDING, formulaExtension, loadFormulaExtension } from "./formulaExt";
import type { DataStruct, Dataset } from "./types";

const base: DataStruct = { time: [1, 2], values: [[1], [2]], labels: ["v"], units: [""], metadata: {} };
const errorOf = (expr: string) => applyFormulasWithErrors(base, [{ name: "f", expr }]).errors.f;

describe("before the extension loads", () => {
  it("every new form reports EXTENSION_PENDING; plain formulas still evaluate", async () => {
    expect(formulaExtension()).toBeNull();
    for (const expr of ["A[1]", "A > 1 ? A : 0"]) expect(errorOf(expr)).toBe(EXTENSION_PENDING);
    // An error (recomputed on load), never a value.
    for (const expr of ["cumsum(A)", 'sheet("x", A)', 'col("v")', "rowmean(A, A)", 'A == "a"', "sum(A[1:2])"]) {
      expect(errorOf(expr)).toBeTruthy();
    }
    expect(errorOf("2 * A")).toBeUndefined();

    const waiting: Dataset = {
      id: "w",
      name: "w",
      data: applyFormulasWithErrors(base, [{ name: "f", expr: "cumsum(A)" }]).data,
      formulas: [{ name: "f", expr: "cumsum(A)" }],
      formulaErrors: { f: EXTENSION_PENDING },
    };
    const textCmp: Dataset = {
      id: "t",
      name: "t",
      data: applyFormulasWithErrors(base, [{ name: "f", expr: 'A == "a"' }]).data,
      formulas: [{ name: "f", expr: 'A == "a"' }],
      formulaErrors: { f: errorOf('A == "a"')! },
    };
    const untouched: Dataset = { id: "u", name: "u", data: base };
    const { recomputeExtensionPending } = await loadFormulaExtension();
    expect(formulaExtension()).not.toBeNull();
    const [w, t, u] = recomputeExtensionPending([waiting, textCmp, untouched]);
    expect(w.data.values.map((r) => r[1])).toEqual([1, 3]);
    expect(w.formulaErrors).toBeUndefined();
    // Re-evaluated with the module: now the REAL diagnosis (A is numeric).
    expect(t.formulaErrors?.f).toMatch(/numeric column; compare it with a number/);
    expect(u).toBe(untouched);
  });
});
