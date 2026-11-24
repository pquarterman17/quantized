// Statistical-tests workshop — GAP_AUDIT_9 G8: life-data request building
// (censor 1 = censored, row order, refusals before any request), the readings,
// the saved-recipe round trip and the dispatcher routes.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LifeByXResult, LifeDistributionResult } from "./api/statsTestsLife";
import { runStatsTest } from "./api/statsTests";
import { statisticalTestAnalysisResult, statisticalTestRecipe } from "./statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, buildTestRequest, testColumns, testUsesAlpha, type TestParams, type TestSelection } from "./statsTests";
import { DEFAULT_LIFE, effectiveLifeDist, lifeSettings, parseNumberList, restoreLife, type LifeParams } from "./statsTestsLife";
import { describeResult } from "./statsTestsResults";
import type { DataStruct } from "./types";

const post = vi.hoisted(() => vi.fn());
vi.mock("./api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api/http")>()), postJSON: post }));
afterEach(() => post.mockReset());

// t = time (row 4 has a gap), c = censor (1 = censored), s = stress
const data: DataStruct = {
  time: [1, 2, 3, 4, 5, 6, 7, 8],
  values: [[10, 0, 100], [20, 0, 100], [30, 1, 100], [NaN, 0, 100], [40, 0, 125], [50, 1, 125], [60, 0, 125], [70, 0, 125]],
  labels: ["t", "c", "s"], units: ["", "", ""], metadata: {},
};
const sel = (over: Partial<TestSelection>): TestSelection => ({ ...DEFAULT_SELECTION, x: 0, y: 1, byCol: 2, ...over });
const params = (life: Partial<LifeParams>, over: Partial<TestParams> = {}): TestParams => ({ ...DEFAULT_PARAMS, ...over, life: { ...DEFAULT_LIFE, ...life } });

describe("life distribution request", () => {
  it("sends time and censor in worksheet order, dropping incomplete rows; Weibull and 95% by default", () => {
    expect(buildTestRequest("life-distribution", data, sel({}), params({}))).toEqual({
      ok: true, labels: ["t", "c"],
      request: {
        id: "life-distribution",
        body: {
          time: [10, 20, 30, 40, 50, 60, 70], censor: [0, 0, 1, 0, 1, 0, 0], distribution: "weibull", compare: false,
          alpha: 0.05, quantile_probs: [0.01, 0.1, 0.5], eval_times: [], plotting: "median-rank",
        },
      },
    });
  });

  it("parses B-life percentages and evaluation times, and refuses bad ones before any request", () => {
    const ok = buildTestRequest("life-distribution", data, sel({}), params({ quantilesText: "10; 63.2", timesText: "25 50", compare: true, distribution: "lognormal" }));
    expect(ok.ok && ok.request.body).toMatchObject({ quantile_probs: [0.1, 0.632], eval_times: [25, 50], compare: true, distribution: "lognormal" });
    expect(buildTestRequest("life-distribution", data, sel({}), params({ quantilesText: "10, x" }))).toEqual({ ok: false, error: expect.stringMatching(/"x" is not a number/) });
    expect(buildTestRequest("life-distribution", data, sel({}), params({ quantilesText: "0, 10" }))).toEqual({ ok: false, error: expect.stringMatching(/between 0 and 100/) });
    expect(buildTestRequest("life-distribution", data, sel({}), params({ timesText: "-5" }))).toEqual({ ok: false, error: expect.stringMatching(/greater than 0/) });
    expect(parseNumberList("")).toEqual([]);
  });

  it("refuses a censor column that is not 0/1, negative times and a repeated column", () => {
    const bad = (rows: number[][]): DataStruct => ({ ...data, values: rows });
    expect(buildTestRequest("life-distribution", bad([[1, 2, 0], [2, 0, 0]]), sel({}), params({}))).toEqual({ ok: false, error: expect.stringMatching(/only 0 \(failed\) and 1 \(censored\)/) });
    expect(buildTestRequest("life-distribution", bad([[-1, 0, 0], [2, 0, 0]]), sel({}), params({}))).toEqual({ ok: false, error: expect.stringMatching(/negative times/) });
    expect(buildTestRequest("life-distribution", data, sel({ y: 0 }), params({})).ok).toBe(false);
    expect(buildTestRequest("life-distribution", null, sel({}), params({}))).toEqual({ ok: false, error: "Select a dataset to analyze." });
  });
});

describe("Fit Life by X request", () => {
  it("adds the stress column, transform and use condition; sev runs (and shows) as Weibull", () => {
    const r = buildTestRequest("life-by-x", data, sel({}), params({ transform: "arrhenius-celsius", useX: 40, distribution: "sev" }));
    expect(r.ok && r.request).toEqual({
      id: "life-by-x",
      body: {
        time: [10, 20, 30, 40, 50, 60, 70], censor: [0, 0, 1, 0, 1, 0, 0], x: [100, 100, 100, 125, 125, 125, 125],
        distribution: "weibull", transform: "arrhenius-celsius", alpha: 0.05, quantile_probs: [0.01, 0.1, 0.5], use_x: 40,
      },
    });
    expect(effectiveLifeDist("life-by-x", { ...DEFAULT_LIFE, distribution: "sev" })).toBe("weibull");
    expect(effectiveLifeDist("life-distribution", { ...DEFAULT_LIFE, distribution: "sev" })).toBe("sev");
    const none = buildTestRequest("life-by-x", data, sel({}), params({}));
    expect(none.ok && "use_x" in (none.request.body as object)).toBe(false);
    expect(buildTestRequest("life-by-x", data, sel({ byCol: 0 }), params({})).ok).toBe(false);
  });
});

describe("columns, alpha and settings", () => {
  it("reads exactly the picked columns; alpha is the confidence level", () => {
    expect(testColumns("life-distribution", sel({}), params({}))).toEqual([0, 1]);
    expect(testColumns("life-by-x", sel({}), params({}))).toEqual([0, 1, 2]);
    expect(testUsesAlpha("life-distribution")).toBe(true);
    expect(lifeSettings("life-distribution", params({ compare: true }))).toContainEqual(["Compare all families", "yes (AICc, BIC)"]);
    expect(lifeSettings("life-by-x", params({ useX: 55 }))).toContainEqual(["Use condition", "55"]);
  });
});

const lifeResult = (): LifeDistributionResult => ({
  distribution: "weibull", n: 20, n_failed: 10, n_censored: 10, alpha: 0.05, ci_method: "Wald",
  parameters: [
    { name: "eta (scale, 63.2% life)", estimate: 606.5, se: 124.9, ci_low: 405.1, ci_high: 908.1 },
    { name: "beta (shape)", estimate: 1.72, se: 0.5, ci_low: 0.97, ci_high: 3.05 },
  ],
  loglik: -75.13, n_params: 2, aicc: 154.98, bic: 156.26,
  comparison: [
    { distribution: "weibull", loglik: -75.13, n_params: 2, aicc: 154.98, bic: 156.26, delta_aicc: 0.3, delta_bic: 0.3 },
    { distribution: "sev", loglik: null, n_params: null, aicc: null, bic: null, note: "no" },
  ],
  quantiles: [{ p: 0.1, time: 164, ci_low: 83.9, ci_high: 320.8 }],
  probabilities: [{ time: 300, probability: 0.2575, ci_low: 0.134, ci_high: 0.46, reliability: 0.7425 }],
  kaplan_meier: { times: [54, 187], survival: [0.95, 0.9], std_error: [0.05, 0.07], ci_low: [0.7, 0.65], ci_high: [0.99, 0.97], at_risk: [20, 19], events: [1, 1], median: null, n: 20, ci_method: "x" },
  plot: { dist: "weibull", std: "sev", x_log: true, method: "median-rank", points: [{ t: 54, p: 0.03, z: -3.4 }], line: [{ t: 40, z: -4, z_low: -5, z_high: -3 }, { t: 600, z: 0, z_low: -1, z_high: 1 }], ticks: [{ p: 0.1, z: -2.25 }] },
});

describe("readings, saved recipe and dispatcher", () => {
  it("states the parameters, the B-life and the censoring, and attaches the picture data", () => {
    const out = describeResult({ id: "life-distribution", data: lifeResult() }, ["t", "c"], 0.05);
    expect(out.sentence).toMatch(/Weibull fit to 20 units \(10 failed, 10 censored\)/);
    expect(out.sentence).toMatch(/eta = 607 \(95% CI 405 to 908\)/);
    expect(out.sentence).toMatch(/B10 life = 164 \(83.9 to 321\)/);
    expect(out.life?.kind).toBe("life");
    expect(out.tables.map((t) => t.title)).toEqual(["Parameter estimates", "Fit statistics", "Model comparison", "Quantiles (B-lives)", "Failure probability at time", "Kaplan-Meier"]);
    expect(out.tables[0].columns[3]).toBe("95% CI low");
    expect(out.tables[2].rows[1]).toEqual(["Smallest extreme value", null, null, null, null, null, null, "no"]);
  });

  it("Fit Life by X reports activation energy and the life at use conditions", () => {
    const r: LifeByXResult = {
      distribution: "weibull", transform: "arrhenius-celsius", n: 8, n_failed: 6, n_censored: 2, alpha: 0.05, ci_method: "Wald",
      parameters: [
        { name: "intercept (b0)", estimate: -20, se: 1, ci_low: -22, ci_high: -18 },
        { name: "slope (b1)", estimate: 0.85, se: 0.04, ci_low: 0.77, ci_high: 0.93 },
        { name: "sigma", estimate: 0.5, se: 0.05, ci_low: 0.4, ci_high: 0.6 },
      ],
      loglik: -50, n_params: 3, aicc: 107, bic: 108, levels: [{ x: 100, x_transformed: 31.1, n: 4, n_failed: 3 }],
      use_x: 40, use_quantiles: [{ p: 0.1, time: 7110, ci_low: 3575, ci_high: 14141 }],
      acceleration: [{ x: 100, factor: 154, ci_low: 95, ci_high: 251 }],
    };
    const out = describeResult({ id: "life-by-x", data: r }, [], 0.05);
    expect(out.sentence).toMatch(/Activation energy Ea = 0.85 eV \(95% CI 0.77 to 0.93\)/);
    expect(out.sentence).toMatch(/at the use condition 40 the B10 life is 7110/);
    expect(out.tables.map((t) => t.title)).toContain("Acceleration factors (use vs tested stress)");
    const noUse = describeResult({ id: "life-by-x", data: { ...r, use_x: null, use_quantiles: [], acceleration: [] } }, [], 0.05);
    expect(noUse.sentence).toMatch(/enter a use condition/);
    expect(noUse.tables.map((t) => t.title)).not.toContain("Life at the use condition");
  });

  it("round-trips the saved recipe; a pre-G8 result reopens with defaults; garbage is refused", () => {
    const p = params({ distribution: "lognormal", compare: true, timesText: "100" });
    const result = statisticalTestAnalysisResult("r1", null, "life-distribution", sel({}), p, ["t", "c"], describeResult({ id: "life-distribution", data: lifeResult() }, ["t", "c"], 0.05));
    expect(statisticalTestRecipe(result)?.params.life).toEqual(p.life);
    const { life: _life, ...oldParams } = (result.parameters as { params: Record<string, unknown> }).params;
    void _life;
    const legacy = { ...result, parameters: { ...result.parameters, params: oldParams } } as unknown as typeof result;
    expect(statisticalTestRecipe(legacy)?.params.life).toEqual(DEFAULT_LIFE);
    expect(restoreLife({ ...DEFAULT_LIFE, distribution: "gamma" })).toBeNull();
    expect(restoreLife({ ...DEFAULT_LIFE, useX: "40" })).toBeNull();
    expect(restoreLife(undefined)).toEqual(DEFAULT_LIFE);
  });

  it("dispatches to the life routes", async () => {
    post.mockResolvedValue({ ok: 1 });
    await runStatsTest({ id: "life-distribution", body: { time: [1, 2], censor: [0, 0] } });
    await runStatsTest({ id: "life-by-x", body: { time: [1, 2], censor: [0, 0], x: [1, 2] } });
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/api/stats/life-distribution", "/api/stats/life-by-x"]);
  });
});
