// Statistical-tests workshop — ROC / GLM / chi-square GoF / p-value adjustment:
// request building (lib/statsTests.ts), the readings (statsTestsResultsExtra.ts)
// and the chained ROC client (api/statsTestsExtra.ts).
import { afterEach, describe, expect, it, vi } from "vitest";

import { statsAdjustP, statsRoc } from "./api/statsTestsExtra";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, buildTestRequest, testColumns, testUsesAlpha, type TestSelection } from "./statsTests";
import { describeResult } from "./statsTestsResults";
import type { DataStruct } from "./types";

const post = vi.hoisted(() => vi.fn());
vi.mock("./api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api/http")>()), postJSON: post }));
afterEach(() => post.mockReset());

// a = 0/1 outcome (NaN at row 5), b = score, c = counts, d = expected (sums to c),
// e = a count response with a fraction, f = p-values (one out of range, one blank).
const data: DataStruct = {
  time: [1, 2, 3, 4, 5, 6],
  values: [
    [0, 0.1, 10, 5, 2, 0.01],
    [0, 0.4, 20, 25, 3, 0.04],
    [1, 0.35, 30, 30, 1, 0.03],
    [1, 0.8, 40, 40, 0, 0.2],
    [NaN, 0.9, 5, 5, 4, NaN],
    [1, 0.7, 0, 0.5, 1.5, 0.5],
  ],
  labels: ["outcome", "score", "counts", "expected", "frac", "pv"],
  units: ["", "", "", "", "", ""],
  metadata: {},
};
const sel = (over: Partial<TestSelection>): TestSelection => ({ ...DEFAULT_SELECTION, ...over });

describe("ROC request", () => {
  it("row-aligns the 0/1 outcome and the score", () => {
    expect(buildTestRequest("roc", data, sel({ x: 0, y: 1 }), DEFAULT_PARAMS)).toEqual({
      ok: true,
      request: { id: "roc", body: { y_true: [0, 0, 1, 1, 1], y_score: [0.1, 0.4, 0.35, 0.8, 0.7] } },
      labels: ["outcome", "score"],
    });
  });

  it("refuses a non-binary outcome, one class only, and the same column twice", () => {
    expect(buildTestRequest("roc", data, sel({ x: 2, y: 1 }), DEFAULT_PARAMS)).toEqual({ ok: false, error: "counts must be coded 0/1 (it has other values)." });
    const one: DataStruct = { ...data, values: data.values.map((r) => [1, ...r.slice(1)]) };
    expect(buildTestRequest("roc", one, sel({ x: 0, y: 1 }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("both outcomes") });
    expect(buildTestRequest("roc", data, sel({ x: 1, y: 1 }), DEFAULT_PARAMS)).toMatchObject({ ok: false });
  });

  it("is chained: the curve, then Youden on its real-threshold points, and reads columns outcome + score", async () => {
    post.mockResolvedValueOnce({
      fpr: [0, 0, 0.5, 1], tpr: [0, 0.5, 1, 1], thresholds: [null, 0.9, 0.4, 0.1], auc: 0.875, N: 4, nPositive: 2, nNegative: 2,
    });
    post.mockResolvedValueOnce({ optimalThreshold: 0.4, youdenJ: 0.5, fpr: 0.5, tpr: 1 });
    const res = await statsRoc({ y_true: [1, 1, 0, 0], y_score: [0.9, 0.4, 0.4, 0.1] });
    expect(post.mock.calls[0][0]).toBe("/api/stats/roc-curve");
    expect(post.mock.calls[1]).toEqual(["/api/stats/youden-threshold", { fpr: [0, 0.5, 1], tpr: [0.5, 1, 1], thresholds: [0.9, 0.4, 0.1] }, undefined]);
    expect(res.youden.optimalThreshold).toBe(0.4);
    expect(testColumns("roc", sel({ x: 0, y: 1 }))).toEqual([0, 1]);
    expect(testUsesAlpha("roc")).toBe(false);
  });

  it("reads the AUC, the cutoff and warns when the score runs backwards", () => {
    const roc = { fpr: [0, 1], tpr: [0, 1], thresholds: [null, 0.2], auc: 0.875, N: 10, nPositive: 4, nNegative: 6 };
    const ok = describeResult({ id: "roc", data: { roc, youden: { optimalThreshold: 0.4, youdenJ: 0.6, fpr: 0.1, tpr: 0.7 } } }, ["y", "s"], 0.05);
    expect(ok.sentence).toBe(
      "AUC = 0.875: s separates y = 1 (4 rows) from y = 0 (6 rows). Youden-optimal cutoff: s >= 0.4 (sensitivity 0.7, specificity 0.9, J = 0.6).",
    );
    expect(ok.tables[1]).toMatchObject({ title: "ROC curve", rows: [[null, 0, 0], [0.2, 1, 1]] });
    const inv = describeResult({ id: "roc", data: { roc: { ...roc, auc: 0.2 }, youden: { optimalThreshold: 0.2, youdenJ: 0, fpr: 1, tpr: 1 } } }, ["y", "s"], 0.05);
    expect(inv.sentence).toContain("LOWER s predicts y = 1");
    expect(inv.sentence).toContain("No cutoff separates the outcomes better than chance.");
  });
});

describe("GLM request", () => {
  it("builds logistic and Poisson bodies from complete rows, with the alpha", () => {
    expect(buildTestRequest("glm-logistic", data, sel({ x: 0, cols: [1, 3] }), { ...DEFAULT_PARAMS, alpha: 0.1 })).toEqual({
      ok: true,
      request: { id: "glm-logistic", body: { y: [0, 0, 1, 1, 1], predictors: [[0.1, 0.4, 0.35, 0.8, 0.7], [5, 25, 30, 40, 0.5]], alpha: 0.1 } },
      labels: ["outcome", "score", "expected"],
    });
    expect(buildTestRequest("glm-poisson", data, sel({ x: 2, cols: [1] }), DEFAULT_PARAMS)).toMatchObject({ ok: true, request: { id: "glm-poisson" } });
  });

  it("refuses a non-0/1 logistic response, fractional counts, and no predictor", () => {
    expect(buildTestRequest("glm-logistic", data, sel({ x: 2, cols: [1] }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("0/1") });
    expect(buildTestRequest("glm-poisson", data, sel({ x: 4, cols: [1] }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("counts") });
    expect(buildTestRequest("glm-poisson", data, sel({ x: 2, cols: [2] }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("predictor") });
  });

  it("reads the significant predictors and adds odds ratios (null when exp overflows)", () => {
    const glm = {
      coeffs: [0.5, Math.log(2), 2000], se: [1, 1, 1], zStats: [0, 2, 3], pValues: [0.9, 0.01, 0.2],
      ciLow: [0, 0, 0], ciHigh: [1, 1, 1], pseudoR2: 0.3, AIC: 20, deviance: 12, yPred: [], N: 30, alpha: 0.05,
    };
    const out = describeResult({ id: "glm-logistic", data: glm }, ["y", "a", "b"], 0.05);
    expect(out.sentence).toContain("significant predictors at the 5% level: a.");
    expect(out.tables[1].columns).toEqual(["term", "odds ratio", "CI low", "CI high"]);
    expect(out.tables[1].rows[0][1]).toBeCloseTo(2);
    expect(out.tables[1].rows[1][1]).toBeNull();
    expect(describeResult({ id: "glm-poisson", data: glm }, ["y", "a", "b"], 0.05).tables[1].columns[1]).toBe("rate ratio");
  });
});

describe("chi-square goodness of fit", () => {
  it("uniform: sends observed counts only; column: sends observed + expected", () => {
    expect(buildTestRequest("chi-square-gof", data, sel({ x: 2 }), DEFAULT_PARAMS)).toMatchObject({
      ok: true, request: { id: "chi-square-gof", body: { observed: [10, 20, 30, 40, 5, 0] } }, labels: ["counts"],
    });
    const col = { ...DEFAULT_PARAMS, gofExpected: "column" as const };
    expect(buildTestRequest("chi-square-gof", data, sel({ x: 2, y: 3 }), col)).toMatchObject({ ok: false, error: expect.stringContaining("total") });
    const even: DataStruct = { ...data, values: data.values.map((r) => [r[0], r[1], r[2] || 1, r[2] || 1, r[4], r[5]]) };
    expect(buildTestRequest("chi-square-gof", even, sel({ x: 2, y: 3 }), col)).toMatchObject({ ok: true, request: { body: { expected: [10, 20, 30, 40, 5, 1] } } });
  });

  it("refuses negative counts, zero expected, one category, and the same column twice", () => {
    const neg: DataStruct = { ...data, values: [[0, 0, -1, 1, 0, 0], [0, 0, 2, 1, 0, 0]] , time: [1, 2] };
    expect(buildTestRequest("chi-square-gof", neg, sel({ x: 2 }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("negative") });
    const zero: DataStruct = { ...data, values: [[0, 0, 1, 0, 0, 0], [0, 0, 2, 3, 0, 0]], time: [1, 2] };
    const col = { ...DEFAULT_PARAMS, gofExpected: "column" as const };
    expect(buildTestRequest("chi-square-gof", zero, sel({ x: 2, y: 3 }), col)).toMatchObject({ ok: false, error: expect.stringContaining("positive") });
    const one: DataStruct = { ...data, values: [[0, 0, 1, 0, 0, 0]], time: [1] };
    expect(buildTestRequest("chi-square-gof", one, sel({ x: 2 }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("2 categories") });
    expect(buildTestRequest("chi-square-gof", data, sel({ x: 2, y: 2 }), col)).toMatchObject({ ok: false });
  });

  it("reads a verdict and only lists the expected column when one is used", () => {
    const r = { chi2: 12, dof: 3, p_value: 0.007, N: 4, method: "m" };
    expect(describeResult({ id: "chi-square-gof", data: r }, ["counts"], 0.05).sentence).toBe(
      "p = 0.007: counts depart from a uniform distribution at the 5% level.",
    );
    expect(describeResult({ id: "chi-square-gof", data: { ...r, p_value: 0.5 } }, ["o", "e"], 0.05).sentence).toBe(
      "p = 0.5: no evidence o depart from the expected counts in e at the 5% level.",
    );
    expect(testColumns("chi-square-gof", sel({ x: 2, y: 3 }))).toEqual([2]);
    expect(testColumns("chi-square-gof", sel({ x: 2, y: 3 }), { gofExpected: "column" })).toEqual([2, 3]);
  });
});

describe("p-value adjustment", () => {
  it("sends the finite p-values with the chosen method, in row order", () => {
    expect(buildTestRequest("adjust-p", data, sel({ x: 5 }), { ...DEFAULT_PARAMS, adjustMethod: "bh" })).toEqual({
      ok: true, request: { id: "adjust-p", body: { p_values: [0.01, 0.04, 0.03, 0.2, 0.5], method: "bh" } }, labels: ["pv"],
    });
  });

  it("refuses values outside [0, 1] and an empty column", () => {
    expect(buildTestRequest("adjust-p", data, sel({ x: 2 }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("between 0 and 1") });
    const blank: DataStruct = { ...data, values: [[0, 0, 0, 0, 0, NaN]], time: [1] };
    expect(buildTestRequest("adjust-p", blank, sel({ x: 5 }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("no numbers") });
  });

  it("pairs each p with its adjusted p and counts what stays significant", async () => {
    post.mockResolvedValueOnce({ adjusted: [0.03, 0.12, 0.09], method: "holm", m: 3 });
    const res = await statsAdjustP({ p_values: [0.01, 0.04, 0.03], method: "holm" });
    expect(res.p_values).toEqual([0.01, 0.04, 0.03]);
    const out = describeResult({ id: "adjust-p", data: res }, ["pv"], 0.05);
    expect(out.sentence).toBe("Holm adjustment of 3 p-values: 1 remain below 5% after adjustment (3 before).");
    expect(out.tables[0].rows).toEqual([[1, 0.01, 0.03, "yes"], [2, 0.04, 0.12, "no"], [3, 0.03, 0.09, "no"]]);
  });
});
