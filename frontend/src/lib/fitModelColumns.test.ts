import { describe, expect, it } from "vitest";

import type { FitModelResponse, FittedModel } from "./api/statsModel";
import { fitModelColumnsData, predictionFormula } from "./fitModelColumns";

const MODEL: FittedModel = {
  response: "y",
  factors: [{ name: "g", kind: "nominal", levels: ["a", "b"] }, { name: "x", kind: "continuous", mean: 2 }],
  terms: [["g"], ["x"], ["g", "x"]], center_polynomials: true,
  parameters: ["Intercept", "g[a]", "x", "g[a]*(x-2)"], coefficients: [1.5, -0.25, 0.5, 0.125],
  covariance: [], df_error: 4, rmse: 0.3,
};

const FIT = {
  summary: { rmse: 0.3 }, alpha: 0.05, t_crit: 2, model: MODEL,
  predicted: [1, null, 3], residual: [0.1, null, -0.2], se_fit: [0.1, null, 0.4],
} as unknown as FitModelResponse;

describe("Fit Model save columns", () => {
  it("writes the formula text with the coefficients and the coding note", () => {
    const { formula, note } = predictionFormula(MODEL, "y");
    expect(formula).toBe("y = 1.5 - 0.25*g[a] + 0.5*x + 0.125*g[a]*(x-2)");
    expect(note).toContain("effect-coded indicator");
    expect(note).toContain("centred by its mean");
  });

  it("builds one row per fitted row keyed by the worksheet row, with t-based intervals", () => {
    const d = fitModelColumnsData({ fit: FIT, responseLabel: "y", responseUnit: "nm", rowIds: [0, 1, 4] },
      { residual: true, meanInterval: true, individualInterval: true });
    expect(d.time).toEqual([1, 5]); // row 2 had no fit
    expect(d.labels).toEqual(["y predicted", "y residual", "y mean lower 95%", "y mean upper 95%", "y indiv lower 95%", "y indiv upper 95%"]);
    expect(d.units).toEqual(Array(6).fill("nm"));
    const half = 2 * Math.hypot(0.4, 0.3);
    expect(d.values[1]).toEqual([3, -0.2, 3 - 0.8, 3 + 0.8, 3 - half, 3 + half]);
  });

  it("predicted only by default", () => {
    const d = fitModelColumnsData({ fit: FIT, responseLabel: "y", responseUnit: "", rowIds: [0, 1, 4] },
      { residual: false, meanInterval: false, individualInterval: false });
    expect(d.labels).toEqual(["y predicted"]);
    expect(d.values).toEqual([[1], [3]]);
  });
});
