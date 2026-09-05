// PERF item (2026-09): computeFormulasIncremental (store/cellEdit.ts's fast
// path for a single-cell edit) must always agree with the full,
// always-correct `recomputeWithErrors` — this is a fast path, never a
// second source of truth. See formulaIncremental.ts's module header for the
// row-local eligibility rule and the error-parity argument.

import { describe, expect, it } from "vitest";

import { recomputeWithErrors } from "./formula";
import { asAlreadyComputed, recomputeFromBase } from "./formulaInputs";
import { computeFormulasIncremental, formulaEvalCounter, isRowLocalFormula } from "./formulaIncremental";
import type { ComputedColumn, DataStruct } from "./types";

/** A base+formulas dataset's `.data`, ALREADY carrying its (stale, pre-edit)
 *  computed columns — the shape both `recompute` and `computeFormulasIncremental`
 *  expect (`asAlreadyComputed`'s precondition). Built via `recomputeFromBase`
 *  (never `recomputeWithErrors`, which STRIPS the last `formulas.length`
 *  columns assuming they're already-stale computed ones — wrong for a
 *  genuinely base-only table like this one; see formulaInputs.ts's header). */
function seed(rows: number, formulas: ComputedColumn[]): DataStruct {
  const time = Array.from({ length: rows }, (_, i) => i);
  const values = Array.from({ length: rows }, (_, i) => [i * 0.5, i % 5, Math.sin(i)]);
  const base: DataStruct = { time, values, labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} };
  return recomputeFromBase(base, formulas).data;
}

/** Apply a single-cell edit to a base column of `data` (`data` already
 *  carries the earlier formula columns — this only patches column `col`,
 *  which must be a base column) without touching the computed columns
 *  (mirrors cellEdit.ts's patch, before either recompute path runs). */
function editCell(data: DataStruct, row: number, col: number, value: number): DataStruct {
  const values = data.values.map((r, i) => (i === row ? r.map((v, c) => (c === col ? value : v)) : r));
  return { ...data, values };
}

describe("computeFormulasIncremental — parity with the full recompute", () => {
  it("agrees on a plain arithmetic formula", () => {
    const formulas: ComputedColumn[] = [{ name: "D", expr: "A + B * 2" }];
    const before = seed(50, formulas);
    const edited = editCell(before, 10, 0, 999);

    const full = recomputeWithErrors(asAlreadyComputed(edited), formulas);
    const incremental = computeFormulasIncremental(asAlreadyComputed(edited), formulas, [10], undefined);

    expect(incremental).not.toBeNull();
    expect(incremental!.data).toEqual(full.data);
    expect(incremental!.errors).toEqual(full.errors);
  });

  it("agrees for a formula that references ANOTHER formula column (dependency order)", () => {
    const formulas: ComputedColumn[] = [
      { name: "D", expr: "A + B" },
      { name: "E", expr: "D * 2 + row()" }, // depends on D, the earlier computed column
    ];
    const before = seed(30, formulas);
    const edited = editCell(before, 5, 1, 42);

    const full = recomputeWithErrors(asAlreadyComputed(edited), formulas);
    const incremental = computeFormulasIncremental(asAlreadyComputed(edited), formulas, [5], undefined);

    expect(incremental).not.toBeNull();
    expect(incremental!.data).toEqual(full.data);
  });

  it("agrees on NaN cells (missing input propagates through the chain)", () => {
    const formulas: ComputedColumn[] = [{ name: "D", expr: "A / B" }];
    const before = seed(20, formulas);
    const edited = editCell(before, 3, 0, Number.NaN);

    const full = recomputeWithErrors(asAlreadyComputed(edited), formulas);
    const incremental = computeFormulasIncremental(asAlreadyComputed(edited), formulas, [3], undefined);

    expect(incremental).not.toBeNull();
    expect(incremental!.data.values[3]).toEqual(full.data.values[3]);
    expect(Number.isNaN(incremental!.data.values[3][3])).toBe(true);
  });

  it("stays error-free through an edit when the full recompute would also stay error-free", () => {
    const formulas: ComputedColumn[] = [{ name: "D", expr: "A * 2" }];
    const before = seed(10, formulas);
    const edited = editCell(before, 0, 0, 5);
    const full = recomputeWithErrors(asAlreadyComputed(edited), formulas);
    const incremental = computeFormulasIncremental(asAlreadyComputed(edited), formulas, [0], undefined);
    expect(incremental!.errors).toEqual(full.errors);
    expect(full.errors).toEqual({});
  });

  it("a formula that already errors on every row (unknown column) is already gated by prevErrors", () => {
    // `Z` isn't a real channel — this formula fails on EVERY row from the
    // moment it's added (deterministic, data-independent), so the seed's own
    // `recomputeWithErrors` already records it, and ANY later edit must go
    // through the prevErrors gate (never guess whether the edited row's
    // failure out-ranks the existing one in row order).
    const formulas: ComputedColumn[] = [{ name: "D", expr: "Z + 1" }];
    const before = seed(10, formulas); // already carries the error from the initial compute
    const prevErrors = recomputeWithErrors(asAlreadyComputed(before), formulas).errors;
    expect(prevErrors.D).toBeTruthy();
    const edited = editCell(before, 0, 0, 5);
    expect(computeFormulasIncremental(asAlreadyComputed(edited), formulas, [0], prevErrors)).toBeNull();
  });

  it("random edits across many rows/cols match the full recompute", () => {
    const formulas: ComputedColumn[] = [
      { name: "D", expr: "A + B * 2" },
      { name: "E", expr: "if(D > 0, D, -D) + C" },
    ];
    let data = seed(200, formulas);
    let rng = 12345;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let trial = 0; trial < 25; trial++) {
      const row = Math.floor(rand() * 200);
      const col = Math.floor(rand() * 2); // A or B (base, non-computed)
      const value = rand() * 100 - 50;
      const edited = editCell(data, row, col, value);
      const full = recomputeWithErrors(asAlreadyComputed(edited), formulas);
      const incremental = computeFormulasIncremental(asAlreadyComputed(edited), formulas, [row], undefined);
      expect(incremental, `trial ${trial}`).not.toBeNull();
      expect(incremental!.data).toEqual(full.data);
      data = full.data; // carry forward, like a live dataset would
    }
  });
});

describe("computeFormulasIncremental — fallback to the full path", () => {
  it("declines (null) when a formula uses an aggregate", () => {
    const formulas: ComputedColumn[] = [{ name: "D", expr: "A - mean(A)" }];
    const data = seed(10, formulas);
    expect(isRowLocalFormula(formulas[0])).toBe(false);
    expect(computeFormulasIncremental(asAlreadyComputed(data), formulas, [0], undefined)).toBeNull();
  });

  it("declines when a formula uses lag()", () => {
    const formulas: ComputedColumn[] = [{ name: "D", expr: "A - lag(A, 1)" }];
    expect(isRowLocalFormula(formulas[0])).toBe(false);
  });

  it("declines when a formula uses diff()", () => {
    const formulas: ComputedColumn[] = [{ name: "D", expr: "diff(A)" }];
    expect(isRowLocalFormula(formulas[0])).toBe(false);
  });

  it("declines for a recode column", () => {
    const formulas: ComputedColumn[] = [
      { name: "R", expr: "", recode: { sourceLetter: "A", mapping: { groups: [] } } },
    ];
    expect(isRowLocalFormula(formulas[0])).toBe(false);
  });

  it("declines when ANY formula in the list is unsafe, even if others are row-local", () => {
    const formulas: ComputedColumn[] = [{ name: "D", expr: "A + 1" }, { name: "E", expr: "sum(A)" }];
    const data = seed(10, formulas);
    expect(computeFormulasIncremental(asAlreadyComputed(data), formulas, [0], undefined)).toBeNull();
  });

  it("declines when the formula already has a recorded error (ambiguous first-row ordering)", () => {
    const formulas: ComputedColumn[] = [{ name: "D", expr: "A + 1" }];
    const data = seed(5, formulas);
    const prevErrors = { D: "some earlier row failed" };
    expect(computeFormulasIncremental(asAlreadyComputed(data), formulas, [0], prevErrors)).toBeNull();
  });

  it("min(A)/max(A) (bare-single aggregate form) are non-row-local; elementwise min/max(A,B) are", () => {
    expect(isRowLocalFormula({ name: "D", expr: "max(A)" })).toBe(false);
    expect(isRowLocalFormula({ name: "D", expr: "max(A, B)" })).toBe(true);
  });

  it("row()/if/arithmetic/comparisons/logicals ARE row-local", () => {
    expect(isRowLocalFormula({ name: "D", expr: "if(A > 0 and B < 5, row(), 0)" })).toBe(true);
  });
});

describe("formulaEvalCounter — load-invariant evaluation count", () => {
  it("evaluates exactly formulas.length times for one changed row, regardless of row count", () => {
    const formulas: ComputedColumn[] = [
      { name: "D", expr: "A + B" },
      { name: "E", expr: "D * 2" },
    ];
    const data = seed(10_000, formulas);
    const edited = editCell(data, 4321, 0, 7);

    formulaEvalCounter.reset();
    const result = computeFormulasIncremental(asAlreadyComputed(edited), formulas, [4321], undefined);
    expect(result).not.toBeNull();
    expect(formulaEvalCounter.n).toBe(formulas.length); // NOT rows * formulas.length
  });
});
