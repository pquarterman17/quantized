import { describe, expect, it } from "vitest";

import type { PawleyResult } from "../../../lib/reductionTypes";
import {
  PAWLEY_DEFAULT_FIELDS,
  cellVolumeFactor,
  parseField,
  pawleyAxisProblem,
  pawleyInputProblem,
  pawleyNumbers,
  pawleyVerdict,
  scanRange,
} from "./pawleyInputs";

describe("parseField", () => {
  it("reads an empty or blank field as NaN, never 0", () => {
    expect(parseField("")).toBeNaN();
    expect(parseField("  ")).toBeNaN();
    expect(parseField("abc")).toBeNaN();
    expect(parseField("5.43")).toBe(5.43);
  });
});

describe("pawleyNumbers", () => {
  const fields = { ...PAWLEY_DEFAULT_FIELDS, a: "4.1", b: "4.2", c: "4.3" };

  it("ties b and c to a for a cubic cell, whatever the hidden fields hold", () => {
    expect(pawleyNumbers(fields, "abc")).toMatchObject({ a: 4.1, b: 4.1, c: 4.1 });
  });

  it("ties only b for a = b", () => {
    expect(pawleyNumbers(fields, "ab")).toMatchObject({ a: 4.1, b: 4.1, c: 4.3 });
  });

  it("leaves all three free when independent", () => {
    expect(pawleyNumbers(fields, "none")).toMatchObject({ a: 4.1, b: 4.2, c: 4.3 });
  });
});

describe("pawleyInputProblem", () => {
  const ok = pawleyNumbers(PAWLEY_DEFAULT_FIELDS, "abc");

  it("accepts the defaults", () => {
    expect(pawleyInputProblem(ok)).toBeNull();
  });

  it.each([
    [{ a: Number.NaN }, /a must be a positive/],
    [{ b: 0 }, /b must be a positive/],
    [{ c: -1 }, /c must be a positive/],
    [{ a: 1001 }, /up to 1000/],
    [{ wavelength: 11 }, /at most 10/],
    [{ fwhm: 21 }, /at most 20/],
    [{ alpha: 0 }, /α must be between/],
    [{ gamma: 180 }, /γ must be between/],
    [{ alpha: 170, beta: 170, gamma: 170 }, /positive-volume/],
    [{ wavelength: 0 }, /wavelength must be positive/],
    [{ fwhm: Number.POSITIVE_INFINITY }, /FWHM must be positive/],
  ])("refuses %o", (over, msg) => {
    expect(pawleyInputProblem({ ...ok, ...over })).toMatch(msg);
  });

  it("uses the same volume test as the backend", () => {
    expect(cellVolumeFactor(90, 90, 90)).toBeCloseTo(1);
    expect(cellVolumeFactor(90, 90, 120)).toBeGreaterThan(0);
    expect(cellVolumeFactor(170, 170, 170)).toBeLessThanOrEqual(0);
  });
});

describe("scanRange", () => {
  it("finds the extent of an unsorted scan", () => {
    expect(scanRange([40, 20, 50, 30])).toEqual({ min: 20, max: 50 });
  });

  it("handles arrays too large to spread into Math.max", () => {
    const x = Array.from({ length: 300_000 }, (_, i) => 10 + i * 1e-4);
    expect(scanRange(x)).toEqual({ min: 10, max: x[x.length - 1] });
  });
});

describe("pawleyAxisProblem", () => {
  const twoTheta = { xLabel: "2-Theta", xUnit: "deg" };
  const range = { min: 20, max: 80 };

  it("accepts a 2θ scan in degrees, including a coupled 2Theta-Omega label", () => {
    expect(pawleyAxisProblem(twoTheta, {}, range)).toBeNull();
    expect(pawleyAxisProblem({ xLabel: "2Theta-Omega", xUnit: "deg" }, {}, range)).toBeNull();
  });

  it.each([
    [{ xLabel: "q", xUnit: "Å⁻¹" }, /not 2θ in degrees/],
    [{ xLabel: "Phi", xUnit: "deg" }, /different angle/],
    [{ xLabel: "Omega", xUnit: "deg" }, /different angle/],
    [{ xLabel: "χ", xUnit: "°" }, /different angle/],
  ])("refuses %o", (axis, msg) => {
    expect(pawleyAxisProblem(axis, {}, range)).toMatch(msg);
  });

  it("refuses a 2-D dataset whose time is a row index", () => {
    expect(pawleyAxisProblem(twoTheta, { is2D: true }, { min: 0, max: 99 })).toMatch(/2-D dataset/);
  });

  it("refuses x values outside a physical 2θ range", () => {
    expect(pawleyAxisProblem(twoTheta, {}, { min: 0, max: 400 })).toMatch(/outside a 2θ range/);
    expect(pawleyAxisProblem(twoTheta, {}, { min: -5, max: -1 })).toMatch(/outside a 2θ range/);
  });

  it("allows a scan that starts below 0 (through the direct beam)", () => {
    expect(pawleyAxisProblem(twoTheta, {}, { min: -2, max: 80 })).toBeNull();
  });
});

describe("pawleyVerdict", () => {
  const base: PawleyResult = {
    cell: [5.43, 5.43, 5.43, 90, 90, 90],
    cell_initial: [5.44, 5.44, 5.44, 90, 90, 90],
    scale: null,
    peaks: [],
    background: [],
    model: [],
    residual: [],
    rwp: 0.05,
    rwp_initial: 0.3,
    rwp_background: 0.4,
    converged: true,
    tie: "abc",
    hkl_max: 8,
    n_peaks: 3,
  };

  it("passes a fit that improved and converged", () => {
    expect(pawleyVerdict(base, true)).toBeNull();
  });

  it("does not flag a good fit whose absolute R_wp is high (low background)", () => {
    // Measured: a right Si cell on a background of 10 has R_wp 2.24 vs 6.21.
    expect(pawleyVerdict({ ...base, rwp: 2.24, rwp_initial: 2.24, rwp_background: 6.21 }, true)).toBeNull();
  });

  it("flags a fit that barely beats the background, whatever its absolute R_wp", () => {
    // Measured: 5.40 → 5.5077 on a background of 2000 has R_wp 0.326 vs 0.368.
    expect(pawleyVerdict({ ...base, rwp: 0.326, rwp_initial: 0.37, rwp_background: 0.368 }, true))
      .toMatch(/explain little beyond the background/);
  });

  it("tolerates a noise-level rise from an already-right start", () => {
    expect(pawleyVerdict({ ...base, rwp: 0.05 * (1 + 1e-4), rwp_initial: 0.05 }, true)).toBeNull();
  });

  it("flags a refinement that ended worse than its start", () => {
    expect(pawleyVerdict({ ...base, rwp: 0.2, rwp_initial: 0.1 }, true)).toMatch(/worse than its starting/);
  });

  it("flags a search that ran out of iterations", () => {
    expect(pawleyVerdict({ ...base, converged: false }, true)).toMatch(/iteration limit/);
  });

  it("flags an undefined R_wp", () => {
    expect(pawleyVerdict({ ...base, rwp: null }, true)).toMatch(/undefined/);
  });

  it("does not judge a fixed-cell fit by the start comparison", () => {
    expect(pawleyVerdict({ ...base, rwp: 0.2, rwp_initial: 0.1 }, false)).toBeNull();
  });
});
