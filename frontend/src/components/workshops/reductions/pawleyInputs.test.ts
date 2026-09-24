import { describe, expect, it } from "vitest";

import type { PawleyResult } from "../../../lib/reductionTypes";
import {
  PAWLEY_DEFAULT_FIELDS,
  cellVolumeFactor,
  parseField,
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
    [{ alpha: 0 }, /α must be between/],
    [{ gamma: 180 }, /γ must be between/],
    [{ alpha: 170, beta: 170, gamma: 170 }, /positive-volume/],
    [{ wavelength: 0 }, /wavelength must be a positive/],
    [{ fwhm: Number.POSITIVE_INFINITY }, /FWHM must be a positive/],
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
    converged: true,
    tie: "abc",
    hkl_max: 8,
    n_peaks: 3,
  };

  it("passes a fit that improved and converged", () => {
    expect(pawleyVerdict(base, true)).toBeNull();
  });

  it("flags R_wp at or above 100 %", () => {
    expect(pawleyVerdict({ ...base, rwp: 1.07, rwp_initial: 1.2 }, true)).toMatch(/worse than none/);
  });

  it("flags a refinement that ended worse than its start", () => {
    expect(pawleyVerdict({ ...base, rwp: 0.4, rwp_initial: 0.3 }, true)).toMatch(/worse than its starting/);
  });

  it("flags a search that ran out of iterations", () => {
    expect(pawleyVerdict({ ...base, converged: false }, true)).toMatch(/iteration limit/);
  });

  it("flags an undefined R_wp", () => {
    expect(pawleyVerdict({ ...base, rwp: null }, true)).toMatch(/undefined/);
  });

  it("does not judge a fixed-cell fit by the start comparison", () => {
    expect(pawleyVerdict({ ...base, rwp: 0.4, rwp_initial: 0.3 }, false)).toBeNull();
  });
});
