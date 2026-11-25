// Statistical-tests workshop — GAP_AUDIT_9 G26 response screening: request
// building (pairwise missing, nominal vs continuous, refusals before any
// request), the readings, the saved-recipe round trip and the dispatcher route.
import { afterEach, describe, expect, it, vi } from "vitest";

import { runStatsTest } from "./api/statsTests";
import type { ResponseScreeningResult, ScreeningRow } from "./api/statsTestsScreen";
import { statisticalTestRecipe } from "./statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, buildTestRequest, testColumns, type TestParams, type TestSelection } from "./statsTests";
import { describeResult } from "./statsTestsResults";
import { DEFAULT_SCREEN, restoreScreen, screenSettings, type ScreenParams } from "./statsTestsScreen";
import type { DataStruct } from "./types";

const post = vi.hoisted(() => vi.fn());
vi.mock("./api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api/http")>()), postJSON: post }));
afterEach(() => post.mockReset());

// channels: 0 = y1, 1 = y2 (one gap), 2 = temp (continuous), 3 = lot (numeric id), 4 = recipe (categorical)
const data: DataStruct = {
  time: [1, 2, 3, 4],
  values: [[1, 5, 10, 1, 0], [2, NaN, 20, 1, 1], [3, 6, 30, 2, 0], [5, 8, 40, 2, 1]],
  labels: ["y1", "y2", "temp", "lot", "recipe"], units: ["", "", "", "", ""], metadata: {},
  cat_levels: { 4: ["A", "B"] },
};
const sel = (cols: number[]): TestSelection => ({ ...DEFAULT_SELECTION, cols });
const params = (screen: Partial<ScreenParams>): TestParams => ({ ...DEFAULT_PARAMS, screen: { ...DEFAULT_SCREEN, ...screen } });

describe("response-screening request", () => {
  it("sends responses and factors with kinds; categorical is nominal, a marked numeric column is nominal", () => {
    const out = buildTestRequest("response-screening", data, sel([0, 1]), params({ xCols: [2, 3, 4], nominalCols: [3] }));
    expect(out).toEqual({
      ok: true, labels: ["y1", "y2", "temp", "lot", "recipe"],
      request: {
        id: "response-screening",
        body: {
          y: [{ name: "y1", values: [1, 2, 3, 5] }, { name: "y2", values: [5, null, 6, 8] }],
          x: [
            { name: "temp", kind: "continuous", values: [10, 20, 30, 40] },
            { name: "lot", kind: "nominal", values: ["1", "1", "2", "2"] },
            { name: "recipe", kind: "nominal", values: ["A", "B", "A", "B"] },
          ],
          method: "bh", alpha: 0.05,
        },
      },
    });
  });

  it("refuses missing picks, overlap and a categorical response before any request", () => {
    expect(buildTestRequest("response-screening", data, sel([]), params({ xCols: [2] }))).toMatchObject({ ok: false, error: expect.stringContaining("response") });
    expect(buildTestRequest("response-screening", data, sel([0]), params({}))).toMatchObject({ ok: false, error: expect.stringContaining("factor") });
    expect(buildTestRequest("response-screening", data, sel([0, 2]), params({ xCols: [2] }))).toMatchObject({ ok: false, error: expect.stringContaining("both") });
    expect(buildTestRequest("response-screening", data, sel([4]), params({ xCols: [2] }))).toMatchObject({ ok: false, error: expect.stringContaining("categorical") });
  });

  it("reads the union of responses and factors", () => {
    expect(testColumns("response-screening", sel([0, 1]), params({ xCols: [2, 3] }))).toEqual([0, 1, 2, 3]);
  });
});

const row = (over: Partial<ScreeningRow>): ScreeningRow => ({
  y: "y1", x: "temp", x_kind: "continuous", test: "linear regression", n: 4, n_levels: null, effect_label: "r", effect_size: 0.9,
  estimate_label: "slope", estimate: 0.1, ci_low: 0, ci_high: 0.2, statistic: 5, df: 2, p: 0.03, p_adjusted: 0.06, logworth: 1.5,
  adj_logworth: 1.2, significant: false, reason: null, ...over,
});
const result: ResponseScreeningResult = {
  method: "bh", alpha: 0.05, n_pairs: 3, n_tested: 2, n_degenerate: 1, n_significant: 1,
  results: [
    row({}),
    row({ x: "lot", x_kind: "nominal", test: "two-sample t (pooled)", p: 0.001, p_adjusted: 0.002, logworth: 3, adj_logworth: 2.7, significant: true }),
    row({ y: "y2", p: null, p_adjusted: null, logworth: null, adj_logworth: null, test: null, effect_label: null, effect_size: null, estimate_label: null, estimate: null, ci_low: null, ci_high: null, reason: "the factor is constant among the complete rows" }),
  ],
};

describe("response-screening reading", () => {
  it("states the discoveries, lists tested pairs by p then the untested with their reason", () => {
    const out = describeResult({ id: "response-screening", data: result }, [], 0.05);
    expect(out.sentence).toBe("1 of 2 tested Y × X pairs are significant after Benjamini-Hochberg adjustment (false discovery rate 5%). 1 pair could not be tested (reasons in the table).");
    const [t] = out.tables;
    expect(t.rows.map((r) => r[1])).toEqual(["lot", "temp", "temp"]);
    expect(t.rows[2][2]).toBe("not tested");
    expect(t.rows[2][t.columns.indexOf("note")]).toMatch(/constant/);
    expect(t.rows[0][t.columns.indexOf("significant at 5%")]).toBe("yes");
    expect(out.screen?.result).toBe(result);
  });

  it("names a family-wise method as such", () => {
    const out = describeResult({ id: "response-screening", data: { ...result, method: "holm" } }, [], 0.05);
    expect(out.sentence).toContain("Holm adjustment (family-wise error rate 5%)");
  });
});

describe("response-screening recipe and routing", () => {
  it("restores saved screen settings and rejects bad ones", () => {
    expect(restoreScreen(undefined)).toBe(DEFAULT_SCREEN);
    expect(restoreScreen({ xCols: [1, 2], nominalCols: [2], method: "by" })).toEqual({ xCols: [1, 2], nominalCols: [2], method: "by" });
    expect(restoreScreen({ xCols: [1.5], nominalCols: [], method: "bh" })).toBeNull();
    expect(restoreScreen({ xCols: [], nominalCols: [], method: "nope" })).toBeNull();
    expect(statisticalTestRecipe).toBeTypeOf("function");
  });

  it("lists settings for the input review", () => {
    expect(screenSettings(params({ method: "by", nominalCols: [3] }))).toEqual([
      ["Adjustment", "Benjamini-Yekutieli (FDR, any dependence)"], ["Factors marked nominal", "1"],
    ]);
  });

  it("posts to the screening route", async () => {
    post.mockResolvedValueOnce(result);
    const out = await runStatsTest({ id: "response-screening", body: { y: [], x: [] } });
    expect(post).toHaveBeenCalledWith("/api/stats/response-screening", { y: [], x: [] }, undefined);
    expect(out.id).toBe("response-screening");
  });
});
