// Statistical-tests workshop — GAP_AUDIT_9 G6: request building and row rules
// (statsTestsMore.ts), the readings (statsTestsResultsMore.ts), the saved-recipe
// round trip, and the dispatcher routes (api/statsTests.ts).
import { afterEach, describe, expect, it, vi } from "vitest";

import { runStatsTest } from "./api/statsTests";
import { statisticalTestAnalysisResult, statisticalTestRecipe } from "./statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, buildTestRequest, testColumns, testUsesAlpha, type TestParams, type TestSelection } from "./statsTests";
import { DEFAULT_MORE, restoreMore, type MoreParams } from "./statsTestsMore";
import { describeResult } from "./statsTestsResults";
import type { DataStruct } from "./types";

const post = vi.hoisted(() => vi.fn());
vi.mock("./api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api/http")>()), postJSON: post }));
afterEach(() => post.mockReset());

// a, b, c = three measurement columns (b has a gap at row 4, c is shorter-valued),
// g = group code for "value by category".
const data: DataStruct = {
  time: [1, 2, 3, 4, 5, 6],
  values: [
    [1, 2, 10, 0], [2, 3, 11, 0], [3, 4, 12, 0], [4, NaN, 13, 1], [5, 6, 14, 1], [6, 7, 15, 1],
  ],
  labels: ["a", "b", "c", "g"],
  units: ["", "", "", ""],
  metadata: {},
};
const sel = (over: Partial<TestSelection>): TestSelection => ({ ...DEFAULT_SELECTION, ...over });
const params = (more: Partial<MoreParams>, over: Partial<TestParams> = {}): TestParams => ({ ...DEFAULT_PARAMS, ...over, more: { ...DEFAULT_MORE, ...more } });

describe("group tests (Welch ANOVA / post hoc / variance)", () => {
  it("keeps each column's own finite values (independent samples)", () => {
    expect(buildTestRequest("welch-anova", data, sel({ groupMode: "columns", cols: [0, 1, 2] }), DEFAULT_PARAMS)).toEqual({
      ok: true,
      request: { id: "welch-anova", body: { groups: [[1, 2, 3, 4, 5, 6], [2, 3, 4, 6, 7], [10, 11, 12, 13, 14, 15]], alpha: 0.05 } },
      labels: ["a", "b", "c"],
    });
  });

  it("splits value-by-category and sends the chosen method", () => {
    const out = buildTestRequest("posthoc", data, sel({ groupMode: "category", x: 0, byCol: 3 }), params({ posthoc: "scheffe" }));
    expect(out).toMatchObject({ ok: true, request: { id: "posthoc", body: { groups: [[1, 2, 3], [4, 5, 6]], method: "scheffe" } } });
    expect(buildTestRequest("variance-test", data, sel({ groupMode: "columns", cols: [0, 2] }), params({ variance: "f-test" })))
      .toMatchObject({ ok: true, request: { body: { method: "f-test" } } });
  });

  it("refuses one group, a thin group, and the F test on 3 groups", () => {
    expect(buildTestRequest("welch-anova", data, sel({ groupMode: "columns", cols: [0] }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("at least 2 groups") });
    const thin: DataStruct = { ...data, values: data.values.map((r, i) => [r[0], i === 0 ? r[1] : NaN, r[2], r[3]]) };
    expect(buildTestRequest("posthoc", thin, sel({ groupMode: "columns", cols: [0, 1] }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining('"b"') });
    expect(buildTestRequest("variance-test", data, sel({ groupMode: "columns", cols: [0, 1, 2] }), params({ variance: "f-test" }))).toMatchObject({ ok: false, error: expect.stringContaining("exactly 2") });
  });
});

describe("equivalence and tolerance requests", () => {
  it("refuses until a positive margin is set (no silent default)", () => {
    expect(buildTestRequest("tost-one", data, sel({ x: 0 }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("equivalence margin") });
    expect(buildTestRequest("tost-two", data, sel({ x: 0, y: 2 }), params({ margin: 0 }))).toMatchObject({ ok: false });
    expect(buildTestRequest("tost-one", data, sel({ x: 0 }), params({ margin: 1, mu0: 3 }))).toMatchObject({
      ok: true, request: { id: "tost-one", body: { x: [1, 2, 3, 4, 5, 6], mu0: 3, margin: 1, alpha: 0.05 } },
    });
  });

  it("paired TOST keeps only rows where both columns are finite; unpaired keeps each column's own values", () => {
    const paired = buildTestRequest("tost-two", data, sel({ x: 0, y: 1 }), params({ margin: 1, tostDesign: "paired" }));
    expect(paired).toMatchObject({ ok: true, request: { body: { x: [1, 2, 3, 5, 6], y: [2, 3, 4, 6, 7], design: "paired" } } });
    const welch = buildTestRequest("tost-two", data, sel({ x: 0, y: 1 }), params({ margin: 1 }));
    expect(welch).toMatchObject({ ok: true, request: { body: { x: [1, 2, 3, 4, 5, 6], y: [2, 3, 4, 6, 7], design: "welch" } } });
    expect(buildTestRequest("tost-two", data, sel({ x: 1, y: 1 }), params({ margin: 1 }))).toMatchObject({ ok: false });
  });

  it("tolerance reads coverage / confidence, not alpha", () => {
    expect(buildTestRequest("tolerance-interval", data, sel({ x: 1 }), params({ coverage: 0.99, confidence: 0.9, tiSides: "upper" }))).toMatchObject({
      ok: true, request: { body: { x: [2, 3, 4, 6, 7], coverage: 0.99, confidence: 0.9, sides: "upper" } },
    });
    expect(buildTestRequest("tolerance-interval", data, sel({ x: 1 }), params({ coverage: 1 }))).toMatchObject({ ok: false });
    expect(testUsesAlpha("tolerance-interval")).toBe(false);
    expect(testUsesAlpha("tost-one")).toBe(true);
  });
});

describe("proportion requests read counts, not columns", () => {
  it("refuse missing, fractional and impossible counts", () => {
    expect(buildTestRequest("binomial-test", null, DEFAULT_SELECTION, DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("Enter the successes") });
    expect(buildTestRequest("two-proportions", null, DEFAULT_SELECTION, params({ x1: 3, n1: 10 }))).toMatchObject({ ok: false, error: expect.stringContaining("group 2") });
    expect(buildTestRequest("fisher-2x2", null, DEFAULT_SELECTION, params({ x1: 2.5, n1: 10, x2: 1, n2: 4 }))).toMatchObject({ ok: false, error: expect.stringContaining("whole numbers") });
    expect(buildTestRequest("binomial-test", null, DEFAULT_SELECTION, params({ x1: 11, n1: 10 }))).toMatchObject({ ok: false, error: expect.stringContaining("cannot exceed") });
  });

  it("build and read no columns", () => {
    expect(buildTestRequest("fisher-2x2", null, DEFAULT_SELECTION, params({ x1: 3, n1: 4, x2: 1, n2: 4 }, { alternative: "greater" }))).toEqual({
      ok: true, request: { id: "fisher-2x2", body: { x1: 3, n1: 4, x2: 1, n2: 4, alternative: "greater", alpha: 0.05 } }, labels: [],
    });
    expect(testColumns("binomial-test", DEFAULT_SELECTION)).toEqual([]);
  });
});

describe("readings", () => {
  const tost = {
    diff: 0.1, se: 0.2, df: 20, low: -1, high: 1, alpha: 0.05, t_lower: 5.5, p_lower: 1e-5, t_upper: -4.5, p_upper: 1e-4, p: 1e-4,
    ci_low: -0.24, ci_high: 0.44, ci_level: 0.9, equivalent: true, effect_size: 0.1, method: "TOST Welch t", design: "welch",
  };
  it("TOST states equivalence and, when not shown, that this is not proof of a difference", () => {
    const yes = describeResult({ id: "tost-two", data: tost }, ["new", "old"], 0.05);
    expect(yes.sentence).toContain("equivalent at the 5% level");
    expect(yes.sentence).toContain("90% CI [-0.24, 0.44]");
    const no = describeResult({ id: "tost-two", data: { ...tost, equivalent: false, p: 0.3 } }, ["new", "old"], 0.05);
    expect(no.sentence).toContain("equivalence NOT shown");
    expect(no.sentence).toContain("does not prove a difference");
  });

  it("post hoc names the pairs, and warns that LSD is uncorrected", () => {
    const pairs = [
      { i: 0, j: 1, diff: -1, p: 0.01, ciLow: -2, ciHigh: -0.1, significant: true, effect_size: -1, se: 0.3, statistic: -3, df: 9 },
      { i: 0, j: 2, diff: -0.1, p: 0.8, ciLow: -1, ciHigh: 0.8, significant: false, effect_size: -0.1, se: 0.3, statistic: -0.3, df: 9 },
    ];
    const out = describeResult({ id: "posthoc", data: { pairs, n_groups: 3, alpha: 0.05, method: "Fisher LSD", key: "lsd", omnibus_p: 0.2, adjusted: false, groups: [] } }, ["A", "B", "C"], 0.05);
    expect(out.sentence).toContain("1 of 2 pairs differ at the 5% level: A vs B");
    expect(out.sentence).toContain("does not correct for multiple comparisons");
    expect(out.sentence).toContain("not significant");
    expect(out.tables[0].columns).toContain("df");
    expect(out.tables[0].rows[0][0]).toBe("A − B");
  });

  it("tolerance interval and proportions give a plain sentence", () => {
    const ti = describeResult({ id: "tolerance-interval", data: { n: 43, mean: 10, sd: 1, coverage: 0.9, confidence: 0.99, sides: "two", k: 2.22, k_howe: 2.217, lower: 7.78, upper: 12.22, method: "m" } }, ["x"], 0.05);
    expect(ti.sentence).toBe("With 99% confidence, at least 90% of the population lies between 7.78 and 12.2 (mean ± k·s with k = 2.22, n = 43). Assumes x is normally distributed.");
    const bin = describeResult({ id: "binomial-test", data: { x: 7, n: 20, phat: 0.35, p0: 0.5, alternative: "two-sided", alpha: 0.05, effect_size: -0.3, p: 0.263, statistic: null, ci_low: 0.15, ci_high: 0.59, ci_method: "Clopper-Pearson", method: "Exact", significant: false } }, [], 0.05);
    expect(bin.sentence).toContain("no evidence the success rate differs from 0.5 at the 5% level");
  });
});

describe("dispatch and saved recipes", () => {
  it("routes each G6 test to its endpoint", async () => {
    post.mockResolvedValue({});
    await runStatsTest({ id: "welch-anova", body: { groups: [[1, 2], [3, 4]] } });
    await runStatsTest({ id: "fisher-2x2", body: { x1: 1, n1: 2, x2: 1, n2: 2 } });
    await runStatsTest({ id: "tolerance-interval", body: { x: [1, 2, 3] } });
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/api/stats/welch-anova", "/api/stats/fisher-2x2", "/api/stats/tolerance-interval"]);
  });

  it("round-trips the G6 settings, reopens pre-G6 results with defaults, and refuses invalid ones", () => {
    const source = { id: "s", name: "m", data, } as never;
    const p = params({ margin: 0.5, tostDesign: "paired", x1: 3, n1: 10 });
    const result = statisticalTestAnalysisResult("r", source, "tost-two", { ...DEFAULT_SELECTION, x: 0, y: 1 }, p, ["a", "b"], { sentence: "s", tables: [] }, "2026-10-10T00:00:00Z");
    expect(statisticalTestRecipe(result)?.params.more).toEqual(p.more);
    const legacy = structuredClone(result);
    delete (legacy.parameters as { params: { more?: unknown } }).params.more;
    expect(statisticalTestRecipe(legacy)?.params.more).toEqual(DEFAULT_MORE);
    const bad = structuredClone(result);
    (bad.parameters as { params: { more: { posthoc: string } } }).params.more.posthoc = "bonferroni";
    expect(statisticalTestRecipe(bad)).toBeNull();
    expect(restoreMore(undefined)).toBe(DEFAULT_MORE);
    expect(restoreMore([])).toBeNull();
  });
});
