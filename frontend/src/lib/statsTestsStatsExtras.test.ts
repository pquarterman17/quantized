// Lane stats-extras: EWMA / CUSUM / rules 5-8 (J14) and Dunn-Šidák, Mood's median,
// Poisson rate, nonparametric tolerance (G6): request building, readings, grouping,
// legacy-recipe restore.
import { afterEach, describe, expect, it, vi } from "vitest";

import { runStatsTest, type StatsTestResult } from "./api/statsTests";
import { statisticalTestAnalysisResult, statisticalTestRecipe } from "./statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, STATS_TESTS, buildTestRequest, testUsesAlpha, type TestParams, type TestSelection } from "./statsTests";
import { statsTestGroups } from "./statsTestGroups";
import { DEFAULT_MORE, restoreMore, type MoreParams } from "./statsTestsMore";
import { describeResult } from "./statsTestsResults";
import { DEFAULT_SPC, restoreSpc, spcSettings, type SpcParams } from "./statsTestsSpc";
import type { DataStruct } from "./types";

const post = vi.hoisted(() => vi.fn());
vi.mock("./api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api/http")>()), postJSON: post }));
afterEach(() => post.mockReset());

const data: DataStruct = {
  time: [1, 2, 3, 4, 5, 6],
  values: [[1, 2], [2, 3], [3, 4], [4, NaN], [5, 6], [6, 7]],
  labels: ["a", "b"], units: ["", ""], metadata: {},
};
const sel = (over: Partial<TestSelection>): TestSelection => ({ ...DEFAULT_SELECTION, ...over });
const more = (m: Partial<MoreParams>, over: Partial<TestParams> = {}): TestParams => ({ ...DEFAULT_PARAMS, ...over, more: { ...DEFAULT_MORE, ...m } });
const spc = (s: Partial<SpcParams>): TestParams => ({ ...DEFAULT_PARAMS, spc: { ...DEFAULT_SPC, ...s } });

describe("catalog grouping", () => {
  it("puts the new tests in the right select groups", () => {
    const groups = Object.fromEntries(statsTestGroups().map((g) => [g.label, g.tests.map((t) => t.id)]));
    expect(groups["Comparisons"]).toContain("mood-median");
    expect(groups["Comparisons"]).toContain("posthoc");
    expect(groups["Equivalence and intervals"]).toContain("tolerance-interval-np");
    expect(groups["Proportions and counts"]).toContain("poisson-rate");
    expect(STATS_TESTS.filter((t) => ["mood-median", "poisson-rate", "tolerance-interval-np"].includes(t.id))).toHaveLength(3);
  });

  it("only the nonparametric tolerance interval drops alpha", () => {
    expect(testUsesAlpha("tolerance-interval-np")).toBe(false);
    expect(testUsesAlpha("poisson-rate")).toBe(true);
    expect(testUsesAlpha("mood-median")).toBe(true);
  });
});

describe("G6 extras request building", () => {
  it("Mood's median and Dunn-Šidák send the groups", () => {
    const s = sel({ groupMode: "columns", cols: [0, 1] });
    expect(buildTestRequest("mood-median", data, s, DEFAULT_PARAMS)).toEqual({
      ok: true, labels: ["a", "b"], request: { id: "mood-median", body: { groups: [[1, 2, 3, 4, 5, 6], [2, 3, 4, 6, 7]], alpha: 0.05 } },
    });
    const r = buildTestRequest("posthoc", data, s, more({ posthoc: "dunn-sidak" }));
    expect(r).toMatchObject({ ok: true, request: { id: "posthoc", body: { method: "dunn-sidak" } } });
  });

  it("Poisson rate needs counts and exposures; one and two sample bodies", () => {
    expect(buildTestRequest("poisson-rate", null, sel({}), more({}))).toMatchObject({ ok: false });
    expect(buildTestRequest("poisson-rate", null, sel({}), more({ pc1: 2.5, pt1: 1 }))).toMatchObject({ ok: false, error: expect.stringContaining("whole number") });
    expect(buildTestRequest("poisson-rate", null, sel({}), more({ pc1: 3, pt1: 0 }))).toMatchObject({ ok: false, error: expect.stringContaining("exposure") });
    expect(buildTestRequest("poisson-rate", null, sel({}), more({ pc1: 12, pt1: 3, rate0: 2 }))).toEqual({
      ok: true, labels: [], request: { id: "poisson-rate", body: { x1: 12, t1: 3, rate0: 2, alternative: "two-sided", alpha: 0.05 } },
    });
    expect(buildTestRequest("poisson-rate", null, sel({}), more({ poissonSamples: "two", pc1: 11, pt1: 800, pc2: 21, pt2: 3011 }))).toEqual({
      ok: true, labels: [], request: { id: "poisson-rate", body: { x1: 11, t1: 800, x2: 21, t2: 3011, ratio0: 1, alternative: "two-sided", alpha: 0.05 } },
    });
    expect(buildTestRequest("poisson-rate", null, sel({}), more({ poissonSamples: "two", pc1: 0, pt1: 1, pc2: 0, pt2: 1 }))).toMatchObject({ ok: false });
  });

  it("nonparametric tolerance keeps finite values and validates coverage", () => {
    expect(buildTestRequest("tolerance-interval-np", data, sel({ x: 1 }), more({ coverage: 0.95, confidence: 0.9, tiSides: "upper" }))).toEqual({
      ok: true, labels: ["b"], request: { id: "tolerance-interval-np", body: { x: [2, 3, 4, 6, 7], coverage: 0.95, confidence: 0.9, sides: "upper" } },
    });
    expect(buildTestRequest("tolerance-interval-np", data, sel({ x: 1 }), more({ coverage: 1 }))).toMatchObject({ ok: false });
  });

  it("restores a pre-lane `more` record with defaults and still refuses an invalid one", () => {
    const { poissonSamples: _a, pc1: _b, pt1: _c, pc2: _d, pt2: _e, rate0: _f, ratio0: _g, ...legacy } = DEFAULT_MORE;
    expect(restoreMore(legacy)).toEqual(DEFAULT_MORE);
    expect(restoreMore({ ...DEFAULT_MORE, poissonSamples: "three" })).toBeNull();
    expect(restoreMore({ ...legacy, posthoc: "bonferroni" })).toBeNull();
  });
});

describe("SPC memory charts and rules 5-8", () => {
  const x = sel({ x: 0 });
  it("EWMA sends lambda / L and only the target and sigma that are set", () => {
    expect(buildTestRequest("control-chart", data, x, spc({ chart: "ewma" }))).toEqual({
      ok: true, labels: ["a"],
      request: { id: "control-chart", body: { chart: "ewma", values: [1, 2, 3, 4, 5, 6], ewma_lambda: 0.2, ewma_width: 3, cusum_k: 0.5, cusum_h: 5 } },
    });
    const r = buildTestRequest("control-chart", data, x, spc({ chart: "cusum", chartTarget: 3, chartSigma: 1.5, cusumH: 4 }));
    expect(r).toMatchObject({ ok: true, request: { body: { chart: "cusum", target: 3, sigma: 1.5, cusum_h: 4 } } });
  });

  it("refuses bad parameters in plain words", () => {
    expect(buildTestRequest("control-chart", data, x, spc({ chart: "ewma", ewmaLambda: 0 }))).toMatchObject({ ok: false, error: expect.stringContaining("λ") });
    expect(buildTestRequest("control-chart", data, x, spc({ chart: "ewma", ewmaLambda: 1.2 }))).toMatchObject({ ok: false });
    expect(buildTestRequest("control-chart", data, x, spc({ chart: "cusum", cusumH: 0 }))).toMatchObject({ ok: false, error: expect.stringContaining("h ") });
    expect(buildTestRequest("control-chart", data, x, spc({ chart: "cusum", chartSigma: -1 }))).toMatchObject({ ok: false });
  });

  it("Nelson rules are sent only when ticked", () => {
    const r = buildTestRequest("control-chart", data, x, spc({ chart: "imr", rules: { ...DEFAULT_SPC.rules, nel5: true, nel8: true } }));
    expect(r).toMatchObject({ ok: true, request: { body: { rules: ["nel5", "nel8"] } } });
    expect(buildTestRequest("control-chart", data, x, spc({ chart: "imr" }))).toMatchObject({ request: { body: { rules: [] } } });
  });

  it("settings list the parameters and where target / sigma come from", () => {
    expect(spcSettings("control-chart", spc({ chart: "ewma" }))).toEqual(expect.arrayContaining([["λ / L", "0.2 / 3"], ["Target", "estimated from the data"]]));
  });

  it("restores a pre-lane spc record (no EWMA fields, 4 rules)", () => {
    const { ewmaLambda: _a, ewmaWidth: _b, cusumK: _c, cusumH: _d, chartTarget: _e, chartSigma: _f, ...legacy } = DEFAULT_SPC;
    const old = { ...legacy, rules: { we1: true, we2: false, we3: false, we4: false } };
    expect(restoreSpc(old)).toEqual({ ...DEFAULT_SPC, rules: { ...DEFAULT_SPC.rules, we1: true } });
    expect(restoreSpc({ ...old, chart: "bogus" })).toBeNull();
    expect(restoreSpc({ ...old, ewmaLambda: "x" })).toBeNull();
  });
});

describe("readings", () => {
  const chart = (kind: "ewma" | "cusum", beyond: number[], extra: object = {}) => ({
    id: "control-chart" as const,
    data: {
      chart: kind, n_subgroups: 6, subgroup_size: 1, sigma_within: 1, grand_mean: 0, dispersion_mean: null, constants: null,
      out_of_control: beyond.length, params: { target: 0, target_source: "set", sigma_source: "estimated from MR-bar / d2" },
      panels: [{ name: kind === "ewma" ? "EWMA" : "CUSUM C+", values: [0, 0, 1, 2, 3, 4], center: 0, ucl: Array(6).fill(2.5), lcl: Array(6).fill(0), beyond_limits: beyond, violations: [], flagged: beyond }],
      ...extra,
    },
  }) as unknown as StatsTestResult;

  it("CUSUM names the signal side and the estimated shift start", () => {
    const out = describeResult(chart("cusum", [3, 4, 5], { signals: [{ side: "upper", first_signal: 3, estimated_shift_start: 1 }] }), ["a"], 0.05);
    expect(out.sentence).toContain("upward shift signalled at point 4, probably starting at point 2");
    expect(out.tables[0].rows.some((r) => r[0] === "sigma_source")).toBe(true);
  });

  it("EWMA with no signal says so and states the estimate source", () => {
    expect(describeResult(chart("ewma", []), ["a"], 0.05).sentence).toContain("no sustained shift");
  });

  it("Mood's median, Poisson and nonparametric tolerance read plainly", () => {
    const mood = describeResult({ id: "mood-median", data: { statistic: 4.2, df: 2, p: 0.012, grand_median: 3, alpha: 0.05, significant: true, n_groups: 3, min_expected: 3, method: "Mood's median test", groups: [{ index: 0, n: 5, above: 1, below: 4, median: 2 }] } } as StatsTestResult, ["a"], 0.05);
    expect(mood.sentence).toContain("the group medians differ");
    expect(mood.sentence).toContain("below 5");
    const two = describeResult({ id: "poisson-rate", data: { samples: 2, x1: 11, t1: 800, rate1: 0.01375, x2: 21, t2: 3011, rate2: 0.007, ratio: 1.97, ratio0: 1, p: 0.08, ci_low: 0.86, ci_high: null, alternative: "two-sided", alpha: 0.05, significant: false, method: "m" } } as StatsTestResult, [], 0.05);
    expect(two.sentence).toContain("no evidence the two event rates differ");
    expect(two.sentence).toContain("∞");
    const tol = describeResult({ id: "tolerance-interval-np", data: { n: 100, coverage: 0.9, confidence: 0.95, sides: "two", lower: 2, upper: 99, rank_from_each_end: 2, achieved_confidence: 0.992, extremes_confidence: 0.9997, min_n_extremes: 46, method: "m" } } as StatsTestResult, ["x"], 0.05);
    expect(tol.sentence).toContain("between 2 and 99");
    expect(tol.sentence).toContain("no distribution assumed");
    expect(tol.sentence).toContain("the 2nd value in from the extreme");
    const ord = (k: number) => describeResult({ id: "tolerance-interval-np", data: { n: 500, coverage: 0.9, confidence: 0.95, sides: "upper", lower: null, upper: 9, rank_from_each_end: k, achieved_confidence: 0.96, extremes_confidence: 1, min_n_extremes: 29, method: "m" } } as StatsTestResult, ["x"], 0.05).sentence;
    expect([ord(3), ord(11), ord(22), ord(14)].map((s) => s.match(/the (\d+\w\w) value/)?.[1])).toEqual(["3rd", "11th", "22nd", "14th"]);
  });

  it("Dunn-Šidák uses the rank table", () => {
    const out = describeResult({ id: "posthoc", data: { key: "dunn-sidak", method: "Dunn (Sidak-adjusted)", adjusted: true, omnibus_p: 0.01, n_groups: 2, alpha: 0.05, groups: [], pairs: [{ i: 0, j: 1, diff: -5, se: 2, statistic: -2.5, df: null, p: 0.02, p_raw: 0.02, ciLow: null, ciHigh: null, effect_size: null, significant: true }] } } as unknown as StatsTestResult, ["a", "b"], 0.05);
    expect(out.tables[0].columns).toContain("p (Šidák-adjusted)");
    expect(out.tables[1].rows[1]).toEqual(["overall Kruskal-Wallis p", 0.01]);
  });
});

describe("dispatch and saved recipe", () => {
  it("routes the new tests to their endpoints", async () => {
    post.mockResolvedValue({});
    await runStatsTest({ id: "mood-median", body: { groups: [[1, 2], [3, 4]] } });
    await runStatsTest({ id: "poisson-rate", body: { x1: 3 } });
    await runStatsTest({ id: "tolerance-interval-np", body: { x: [1, 2, 3] } });
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/api/stats/mood-median", "/api/stats/poisson-rate", "/api/stats/tolerance-interval-np"]);
  });

  it("a saved Poisson recipe round-trips", () => {
    const source = { id: "s", name: "m", data } as never;
    const p = more({ poissonSamples: "two", pc1: 4, pt1: 2, pc2: 9, pt2: 3 });
    const result = statisticalTestAnalysisResult("r", source, "poisson-rate", DEFAULT_SELECTION, p, [], { sentence: "s", tables: [] }, "2026-11-24T00:00:00Z");
    expect(statisticalTestRecipe(result)?.params.more).toEqual(p.more);
  });
});
