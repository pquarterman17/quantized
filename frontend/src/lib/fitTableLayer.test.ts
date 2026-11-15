// The fit results table (lib/fitTableLayer): number format, the three fit kinds'
// cells, the table caps and that the layer survives the layer validator.

import { describe, expect, it } from "vitest";

import {
  batchFitTable, DEFAULT_WANT, fitTableLayer, fitToCaps, globalFitTable, plain, singleFitTable, valueWithError,
} from "./fitTableLayer";
import { MAX_TABLE_COLS, MAX_TABLE_ROWS, sanitizeLayers } from "./graphLayers";

describe("number format", () => {
  it("rounds the value to the error's decimals (two significant figures of the error)", () => {
    expect(valueWithError(1.23456, 0.01234)).toBe("1.235 ± 0.012");
    expect(valueWithError(12.3456, 0.5)).toBe("12.35 ± 0.50");
    expect(valueWithError(300, 2)).toBe("300.0 ± 2.0");
  });
  it("shares one exponent at large or small magnitudes", () => {
    expect(valueWithError(1.234e-5, 4.2e-7)).toBe("(1.234 ± 0.042)e-5");
    expect(valueWithError(2.5e6, 1.1e4)).toBe("(2.500 ± 0.011)e6");
  });
  it("prints a value alone (no ±) without a usable error, a dash for a missing number", () => {
    expect(valueWithError(0.123456, null)).toBe("0.1235 (no error)");
    expect(valueWithError(0.5, 0)).toBe("0.5 (no error)");
    expect(valueWithError(Number.NaN, 1)).toBe("–");
    expect(plain(undefined)).toBe("–");
    expect(plain(1.5e-7)).toBe("1.500e-7");
  });
});

describe("tables", () => {
  const result = { params: [2.5, 0.12], errors: [0.05, null], R2: 0.99876543, chiSqRed: 1.2345, chiSq: 12.3456, nPoints: 12 };

  it("single fit: parameters ± errors, then only the chosen statistics", () => {
    expect(singleFitTable(["A", "tau"], result, DEFAULT_WANT)).toEqual([
      ["Parameter", "Value"], ["A", "2.500 ± 0.050"], ["tau", "0.12 (no error)"], ["R²", "0.99877"], ["Reduced χ²", "1.234"],
    ]);
    const all = singleFitTable(["A", "tau"], result, { r2: false, chiSqRed: false, chiSq: true, n: true });
    expect(all.slice(-2)).toEqual([["χ²", "12.35"], ["N", "12"]]);
  });

  it("global fit: a column per own parameter, shared ones once", () => {
    const rows = globalFitTable({
      paramNames: ["A", "k"], sharedIdx: [1], chiSqRed: 1.1, nTotal: 40,
      members: [
        { label: "s1", params: [2, 0.5], errors: [0.1, 0.02], R2: 0.99, chiSq: 3 },
        { label: "s2", params: [3, 0.5], errors: [0.2, 0.02], R2: 0.98, chiSq: 4 },
      ],
    }, DEFAULT_WANT);
    expect(rows).toEqual([
      ["Shared parameter", "Value"],
      ["k", "0.500 ± 0.020"],
      ["Series", "A", "R²"],
      ["s1", "2.00 ± 0.10", "0.99"],
      ["s2", "3.00 ± 0.20", "0.98"],
      ["Reduced χ²", "1.1"],
    ]);
  });

  it("batch: one row per input", () => {
    const rows = batchFitTable(["tau"], [
      { name: "a", params: [1.5], errors: [0.1], R2: 0.9, chiSqRed: 2 },
      { name: "b", params: [], errors: [], R2: undefined, chiSqRed: undefined },
    ], DEFAULT_WANT);
    expect(rows).toEqual([["Input", "tau", "R²", "Reduced χ²"], ["a", "1.50 ± 0.10", "0.9", "2"], ["b", "–", "–", "–"]]);
  });
});

describe("number format edge cases (L1, M7)", () => {
  it("never prints an undetermined or held parameter as an exact number", () => {
    for (const e of [Number.NaN, Infinity, 0, null]) expect(valueWithError(5, e)).toBe("5 (no error)");
  });
  it("takes the exponent from the larger of value and error, and keeps two significant figures", () => {
    expect(valueWithError(1e-4, 1)).toBe("0.0 ± 1.0");
    expect(valueWithError(12.3, 123)).toBe("10 ± 120");
    expect(valueWithError(1, 1e-25)).toBe("1 ± 1.0e-25");
  });
  it("a global fit whose parameters are all shared has no empty series block (L2)", () => {
    const rows = globalFitTable({
      paramNames: ["a", "b"], sharedIdx: [0, 1], chiSqRed: 1, nTotal: 10,
      members: [{ label: "s1", params: [1, 2], errors: [0.1, 0.2], R2: 1, chiSq: 1 }, { label: "s2", params: [1, 2], errors: [0.1, 0.2], R2: 1, chiSq: 1 }],
    }, { r2: false, chiSqRed: true, chiSq: false, n: false });
    expect(rows).toEqual([["Shared parameter", "Value"], ["a", "1.00 ± 0.10"], ["b", "2.00 ± 0.20"], ["Reduced χ²", "1"]]);
  });
});

describe("held parameters (M7)", () => {
  const result = { params: [2, 0.5], errors: [0.1, Number.NaN], R2: 1, chiSqRed: 1 };
  it("a held parameter says (fixed); a free one without an error says (no error)", () => {
    const rows = singleFitTable(["A", "B"], result, { r2: false, chiSqRed: false, chiSq: false, n: false }, [false, true]);
    expect(rows[1]![1]).toBe("2.00 ± 0.10");
    expect(rows[2]![1]).toBe("0.5 (fixed)");
    expect(singleFitTable(["A", "B"], result, { r2: false, chiSqRed: false, chiSq: false, n: false })[2]![1]).toBe("0.5 (no error)");
    expect(batchFitTable(["B"], [{ name: "a", params: [0.5], errors: [Number.NaN], R2: 1, chiSqRed: 1 }], DEFAULT_WANT, [true])[1]![1]).toBe("0.5 (fixed)");
  });
});

describe("the layer", () => {
  it("is a valid table layer with a header row; oversize tables are cut to the caps", () => {
    const layer = fitTableLayer("t1", [["Parameter", "Value"], ["A", "1 ± 0.1"]]);
    expect(layer).toMatchObject({ kind: "table", header: true, rows: [["Parameter", "Value"], ["A", "1 ± 0.1"]] });
    expect(sanitizeLayers([layer])).toEqual([layer]);
    const big = Array.from({ length: MAX_TABLE_ROWS + 5 }, () => Array.from({ length: MAX_TABLE_COLS + 2 }, () => "x"));
    const cut = fitToCaps(big);
    expect(cut.cut).toBe(true);
    expect(cut.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(cut.rows[0]).toHaveLength(MAX_TABLE_COLS);
    expect(fitToCaps([["a"]]).cut).toBe(false);
  });
});
