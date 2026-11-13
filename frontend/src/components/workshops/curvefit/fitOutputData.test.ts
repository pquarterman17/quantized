// "Output to worksheet" builders (audit #8): linked formula columns use the
// fit's own X/Y columns and fitval(), names never collide, only closed-form
// models link, and the result sheet carries the requested columns plus the
// fit's provenance.

import { describe, expect, it } from "vitest";

import type { BandsResult } from "../../../lib/api/fitStats";
import type { DataStruct } from "../../../lib/types";
import { canLinkModel, colLetter, linkedColumns, resultSheetData } from "./fitOutputData";

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [[5, 1, 9], [6, 2, 8], [7, 3, 7]],
  labels: ["T", "M", "dM"],
  units: ["K", "emu", "emu"],
  metadata: { x_column_name: "t", x_column_unit: "s" },
};

describe("colLetter", () => {
  it("is the inverse of the worksheet's letter naming", () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(colLetter)).toEqual(["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});

describe("linkedColumns", () => {
  it("evaluates the saved fit at the fit's X column and subtracts it from Y", () => {
    const cols = linkedColumns({ data: DATA }, "Linear", 0, 1, { fitted: true, residual: true });
    expect(cols).toEqual([
      { name: "M fit", expr: 'fitval("Linear", A)' },
      { name: "M residual", expr: 'B - fitval("Linear", A)' },
    ]);
  });

  it("uses x for the time axis and dedupes names against labels and formulas", () => {
    const cols = linkedColumns(
      { data: { ...DATA, labels: ["T", "M", "M fit"] }, formulas: [{ name: "M fit (2)", expr: "1" } as never] },
      "Exponential Decay", null, 1, { fitted: true, residual: false },
    );
    expect(cols).toEqual([{ name: "M fit (3)", expr: 'fitval("Exponential Decay", x)' }]);
  });

  it("links only models with a worksheet formula", () => {
    expect(canLinkModel("Gaussian")).toBe(true);
    expect(canLinkModel("Pseudo-Voigt")).toBe(false);
    expect(canLinkModel("toString")).toBe(false);
  });
});

describe("resultSheetData", () => {
  const band: BandsResult = { yFit: [1, 2], ciLo: [0.9, 1.9], ciHi: [1.1, 2.1], piLo: [0.5, 1.5], piHi: [1.5, 2.5], level: 0.9 };
  const base = {
    source: { id: "d1", name: "run", data: DATA },
    model: "Linear",
    paramNames: ["m", "b"],
    result: { params: [1, 1], errors: [0.1, null], yFit: [1, 2], residuals: [0.5, null] },
    fitData: { x: [0, 1], y: [1.5, 2], xKey: null, yKey: 1, dy: null },
  };

  it("writes X, Y, fitted, residual and the bands, NaN for gaps", () => {
    const d = resultSheetData({ ...base, band, want: { fitted: true, residual: true, ci: true, pi: true } });
    expect(d.labels).toEqual(["M", "M fit", "M residual", "90% CI low", "90% CI high", "90% PI low", "90% PI high"]);
    expect(d.time).toEqual([0, 1]);
    expect(d.values[1]![2]).toBeNaN();
    expect(d.values[0]).toEqual([1.5, 1, 0.5, 0.9, 1.1, 0.5, 1.5]);
    expect(d.units[0]).toBe("emu");
    expect(d.metadata).toMatchObject({ x_column_name: "t", x_column_unit: "s" });
    expect(d.metadata!.fitOutput).toMatchObject({
      source: { id: "d1", name: "run" }, model: "Linear", params: [1, 1], errors: [0.1, null], level: 0.9, confidence: true, prediction: true, weighted: false,
    });
  });

  it("writes the prediction limits alone when only they are asked for", () => {
    // Before the fix a prediction-only request also wrote the two CI columns.
    const d = resultSheetData({ ...base, band, want: { fitted: true, residual: false, ci: false, pi: true } });
    expect(d.labels).toEqual(["M", "M fit", "90% PI low", "90% PI high"]);
    expect(d.values[0]).toEqual([1.5, 1, 0.5, 1.5]);
    expect(d.metadata!.fitOutput).toMatchObject({ level: 0.9, confidence: false, prediction: true });
    const c = resultSheetData({ ...base, band, want: { fitted: false, residual: false, ci: true } });
    expect(c.labels).toEqual(["M", "90% CI low", "90% CI high"]);
  });

  it("writes only the requested fit columns", () => {
    const d = resultSheetData({ ...base, band: null, want: { fitted: false, residual: true } });
    expect(d.labels).toEqual(["M", "M residual"]);
  });
});
