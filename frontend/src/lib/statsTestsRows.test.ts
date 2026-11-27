// Row-wise t-tests, Mann-Kendall, Steel-Dwass and ANOVA effect sizes: request
// building, readings, the committed worksheet and saved-record restore.
import { describe, expect, it } from "vitest";

import type { StatsTestResult } from "./api/statsTests";
import type { RowTTestsResult } from "./api/statsTestsRows";
import { rowTestWorksheet } from "./rowTestWorksheet";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, STATS_TESTS, buildTestRequest, testColumns, testUsesAlpha, type TestParams, type TestSelection } from "./statsTests";
import { statsTestGroups } from "./statsTestGroups";
import { describeResult } from "./statsTestsResults";
import { DEFAULT_ROWT, ROWT_VARIANCES, restoreRowT, rowTSettings, type RowTParams } from "./statsTestsRows";
import type { DataStruct } from "./types";

// Rows are experiments: a1..a3 are replicates of group A, b1..b3 of group B; row 1
// has a missing cell, row 3 is constant in A. ch6 is categorical.
const data: DataStruct = {
  time: [10, 20, 30, 40],
  values: [
    [1, 2, 3, 4, 5, 6, 0],
    [2, NaN, 4, 5, 7, 9, 1],
    [3, 3, 3, 4, 6, 8, 0],
    [5, 6, 7, 1, 2, 3, 1],
  ],
  labels: ["a1", "a2", "a3", "b1", "b2", "b3", "grp"],
  units: ["", "", "", "", "", "", ""],
  metadata: { x_column_name: "t" },
  cat_levels: { 6: ["x", "y"] },
};

const sel = (over: Partial<TestSelection>): TestSelection => ({ ...DEFAULT_SELECTION, ...over });
const params = (rowt: Partial<RowTParams>, over: Partial<TestParams> = {}): TestParams => ({
  ...DEFAULT_PARAMS, ...over, rowt: { ...DEFAULT_ROWT, ...rowt },
});

describe("registry", () => {
  it("lists the two new tests in groups and reads alpha", () => {
    const ids = STATS_TESTS.map((t) => t.id);
    expect(ids).toContain("row-t-tests");
    expect(ids).toContain("mann-kendall");
    const groups = Object.fromEntries(statsTestGroups().map((g) => [g.label, g.tests.map((t) => t.id)]));
    expect(groups["Comparisons"]).toContain("row-t-tests");
    expect(groups["Regression and classification"]).toContain("mann-kendall");
    expect(testUsesAlpha("row-t-tests") && testUsesAlpha("mann-kendall")).toBe(true);
  });
});

describe("row-wise t-test request", () => {
  it("defaults to Welch like the single t-test and sends the pooled form when chosen", () => {
    expect(DEFAULT_ROWT.variance).toBe("welch");
    const base = sel({ cols: [0, 1, 2] });
    const welch = buildTestRequest("row-t-tests", data, base, params({ groupB: [3, 4, 5] }));
    expect(welch).toMatchObject({ ok: true, request: { id: "row-t-tests", body: { design: "two-sample", variance: "welch", mu: 0, alpha: 0.05 } } });
    const pooled = buildTestRequest("row-t-tests", data, base, params({ groupB: [3, 4, 5], variance: "pooled" }));
    expect(pooled).toMatchObject({ ok: true, request: { body: { variance: "pooled" } } });
  });

  it("sends one row per analysis-view row, missing cells as null, and the row X values", () => {
    const out = buildTestRequest("row-t-tests", data, sel({ cols: [0, 1, 2] }), params({ groupB: [3, 4, 5] }));
    if (!out.ok || out.request.id !== "row-t-tests") throw new Error("expected a row-t request");
    expect(out.request.body.a).toEqual([[1, 2, 3], [2, null, 4], [3, 3, 3], [5, 6, 7]]);
    expect(out.request.body.b).toEqual([[4, 5, 6], [5, 7, 9], [4, 6, 8], [1, 2, 3]]);
    expect(out.rowX).toEqual([10, 20, 30, 40]);
    expect(out.labels).toEqual(["a1, a2, a3", "b1, b2, b3"]);
  });

  it("one-sample sends no group B; paired pairs columns in worksheet order", () => {
    const one = buildTestRequest("row-t-tests", data, sel({ cols: [0, 1] }), params({ design: "one-sample", mu: 2 }));
    if (!one.ok || one.request.id !== "row-t-tests") throw new Error("expected ok");
    expect(one.request.body.b).toBeUndefined();
    expect(one.request.body.mu).toBe(2);
    const paired = buildTestRequest("row-t-tests", data, sel({ cols: [2, 0] }), params({ design: "paired", groupB: [4, 3] }));
    if (!paired.ok || paired.request.id !== "row-t-tests") throw new Error("expected ok");
    expect(paired.request.body.a?.[0]).toEqual([1, 3]);
    expect(paired.request.body.b?.[0]).toEqual([4, 5]);
  });

  it("says plainly what is missing or wrong", () => {
    const err = (s: Partial<TestSelection>, r: Partial<RowTParams>) => {
      const out = buildTestRequest("row-t-tests", data, sel(s), params(r));
      return out.ok ? null : out.error;
    };
    expect(err({ cols: [] }, {})).toMatch(/group A/);
    expect(err({ cols: [0] }, {})).toMatch(/group B/);
    expect(err({ cols: [0, 1] }, { groupB: [1, 2] })).toMatch(/a2 is in both/);
    expect(err({ cols: [0, 1] }, { design: "paired", groupB: [2] })).toMatch(/same number/);
    expect(err({ cols: [6] }, { groupB: [3] })).toMatch(/categorical/);
  });

  it("reads exactly the picked columns", () => {
    const p = params({ groupB: [3, 4] });
    expect(testColumns("row-t-tests", sel({ cols: [0, 1] }), p)).toEqual([0, 1, 3, 4]);
    expect(testColumns("row-t-tests", sel({ cols: [0, 1] }), params({ design: "one-sample", groupB: [3] }))).toEqual([0, 1]);
  });

  it("labels the variance choices and lists them in the settings", () => {
    expect(ROWT_VARIANCES.map((v) => v.label)).toEqual(["Student (pooled variance; Origin's row-wise default)", "Welch (unequal variances)"]);
    expect(rowTSettings(params({ variance: "pooled" }))).toEqual(expect.arrayContaining([["Variance", expect.stringContaining("Origin")]]));
    expect(rowTSettings(params({ design: "paired" })).map(([k]) => k)).not.toContain("Variance");
  });

  it("restores a saved record, defaults when absent, refuses invalid", () => {
    expect(restoreRowT(undefined)).toEqual(DEFAULT_ROWT);
    expect(restoreRowT({ ...DEFAULT_ROWT, variance: "pooled", groupB: [1] })).toMatchObject({ variance: "pooled" });
    expect(restoreRowT({ ...DEFAULT_ROWT, variance: "bogus" })).toBeNull();
    expect(restoreRowT({ ...DEFAULT_ROWT, groupB: [1.5] })).toBeNull();
    expect(restoreRowT([])).toBeNull();
  });
});

const rowResult = (over: Partial<RowTTestsResult> = {}): StatsTestResult => ({
  id: "row-t-tests",
  data: {
    design: "two-sample", variance: "pooled", mu: 0, alpha: 0.05, alternative: "two-sided", method: "Row-wise two-sample t-test (Student, pooled variance)",
    n_rows: 3, n_tested: 2,
    rows: [
      { row: 0, n1: 3, n2: 3, mean1: 2, mean2: 5, diff: -3, se: 0.5, t: -6, df: 4, p: 0.004, ci_low: -4, ci_high: -2, status: "ok" },
      { row: 1, n1: 3, n2: 3, mean1: 3, mean2: 4, diff: -1, se: 1, t: -1, df: 4, p: 0.37, ci_low: -4, ci_high: 2, status: "ok" },
      { row: 2, n1: 3, n2: 3, mean1: 3, mean2: 3, diff: 0, se: null, t: null, df: null, p: null, ci_low: null, ci_high: null, status: "zero variance in this row: the standard error is 0" },
    ],
    ...over,
  },
});

describe("row-wise readings and worksheet", () => {
  it("states the method, counts and the missing adjustment; keeps untestable rows", () => {
    const out = describeResult(rowResult(), ["a", "b"], 0.05);
    expect(out.sentence).toContain("pooled variance");
    expect(out.sentence).toContain("2 of 3 rows tested; 1 has p < 0.05");
    expect(out.sentence).toContain("not adjusted");
    expect(out.sentence).toContain("1 row could not be tested");
    const table = out.tables[0];
    expect(table.columns[0]).toBe("source row");
    expect(table.rows.map((r) => r[0])).toEqual([1, 2, 3]);
    expect(table.columns).toContain("status");
    expect(table.rows).toHaveLength(3);
    expect(table.rows[2][table.columns.indexOf("p")]).toBeNull();
  });

  it("omits the status column when every row was tested", () => {
    const r = rowResult();
    if (r.id !== "row-t-tests") throw new Error("x");
    const ok = describeResult({ id: "row-t-tests", data: { ...r.data, rows: r.data.rows.slice(0, 2), n_rows: 2 } }, ["a", "b"], 0.05);
    expect(ok.tables[0].columns).not.toContain("status");
  });

  it("commits one worksheet row per input row with NaN for untested rows", () => {
    const r = rowResult();
    if (r.id !== "row-t-tests") throw new Error("x");
    const ws = rowTestWorksheet(r.data, [10, 20, 30], "t", "s");
    expect(ws.time).toEqual([10, 20, 30]);
    expect(ws.labels).toEqual(["source row", "n A", "n B", "mean A", "mean B", "difference", "SE", "t", "df", "p", "CI low", "CI high"]);
    expect(ws.values[0][ws.labels.indexOf("p")]).toBe(0.004);
    expect(Number.isNaN(ws.values[2][ws.labels.indexOf("p")])).toBe(true);
    expect(ws.values.every((row) => row.length === ws.labels.length)).toBe(true);
    expect(ws.values.map((v) => v[0])).toEqual([1, 2, 3]);
    // with rows dropped, the leading column names the true source rows (1-based)
    expect(rowTestWorksheet(r.data, [10, 20, 30], "t", "s", [1, 4, 5]).values.map((v) => v[0])).toEqual([2, 5, 6]);
    const named = describeResult(r, ["a", "b"], 0.05, [1, 4, 5]);
    expect(named.tables[0].rows.map((row) => row[0])).toEqual([2, 5, 6]);
    expect(ws.metadata).toMatchObject({ x_column_name: "t", x_unit: "s" });
  });
});

describe("Mann-Kendall", () => {
  const series: DataStruct = {
    time: [1, 2, 3, 4, 5],
    values: [[1], [2], [NaN], [4], [5]],
    labels: ["y"], units: [""], metadata: { x_column_name: "t" },
  };
  it("sends time and values, dropping rows where either is missing", () => {
    const out = buildTestRequest("mann-kendall", series, sel({ x: -1, y: 0 }), DEFAULT_PARAMS);
    expect(out).toEqual({ ok: true, request: { id: "mann-kendall", body: { y: [1, 2, 4, 5], x: [1, 2, 4, 5], alpha: 0.05 } }, labels: ["t", "y"] });
  });
  it("refuses the same column twice and too few rows", () => {
    expect(buildTestRequest("mann-kendall", series, sel({ x: 0, y: 0 }), DEFAULT_PARAMS)).toMatchObject({ ok: false });
    const tiny = { ...series, time: [1, 2], values: [[1], [2]] };
    expect(buildTestRequest("mann-kendall", tiny, sel({ x: -1, y: 0 }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("3 rows") });
  });
  it("reads the trend, Sen's slope and its interval", () => {
    const base = { n: 5, S: 10, var_S: 16.7, Z: 2.2, p: 0.027, tau: 1, sen_slope: 1, sen_ci_low: 0.8, sen_ci_high: 1.2, sen_intercept: 0, n_tie_groups: 0, alpha: 0.05, significant: true, trend: "increasing" as const, method: "m" };
    const out = describeResult({ id: "mann-kendall", data: base }, ["t", "y"], 0.05);
    expect(out.sentence).toContain("significant increasing trend");
    expect(out.sentence).toContain("Sen's slope 1 per unit of t");
    expect(out.sentence).toContain("95% CI [0.8, 1.2]");
    const flat = describeResult({ id: "mann-kendall", data: { ...base, p: 0.4, significant: false, trend: "no trend" } }, ["t", "y"], 0.05);
    expect(flat.sentence).toContain("no evidence of a monotonic trend");
  });
});

describe("Steel-Dwass and effect sizes", () => {
  it("shows pairwise rank sums, z, q and the studentized-range p", () => {
    const pair = { i: 0, j: 1, W: 6, diff: -4.5, se: 2.29, statistic: -1.96, q: 2.78, df: null, p_raw: 0.05, p: 0.0495, ciLow: null, ciHigh: null, effect_size: null, significant: true };
    const out = describeResult({ id: "posthoc", data: { key: "steel-dwass", method: "Steel-Dwass", adjusted: true, omnibus_p: 0.04, n_groups: 2, alpha: 0.05, groups: [], pairs: [pair] } } as unknown as StatsTestResult, ["a", "b"], 0.05);
    expect(out.tables[0].columns).toEqual(["pair", "W (rank sum of first)", "W − E(W)", "z", "q (√2·|z|)", "p (studentized range)", "significant"]);
    expect(out.tables[0].rows[0]).toEqual(["a − b", 6, -4.5, -1.96, 2.78, 0.0495, "yes"]);
    expect(out.tables[1].rows).toContainEqual(["overall Kruskal-Wallis p", 0.04]);
  });

  it("adds an Effect sizes table beside the two-way ANOVA table, not instead of it", () => {
    const table = [
      { source: "A", SS: 4, df: 1, MS: 4, F: 4, p: 0.1 },
      { source: "Error", SS: 4, df: 4, MS: 1, F: null, p: null },
      { source: "Total", SS: 8, df: 5, MS: null, F: null, p: null },
    ];
    const es = { source: "A", eta_sq: 0.5, partial_eta_sq: 0.5, omega_sq: 0.3, partial_omega_sq: 0.3, cohens_f: 1 };
    const full = describeResult({ id: "anova2-unbalanced", data: { table, ss_type: 3, a_levels: [], b_levels: [], cell_counts: [], balanced: true, n_obs: 6, alpha: 0.05, effect_sizes: [es] } }, ["y", "fa", "fb"], 0.05);
    expect(full.tables.map((t) => t.title)).toEqual(["Type 3 SS", "Effect sizes"]);
    expect(full.tables[1].columns).toEqual(["source", "η²", "partial η²", "ω²", "partial ω²", "Cohen's f"]);
    expect(full.tables[1].rows[0]).toEqual(["fa", 0.5, 0.5, 0.3, 0.3, 1]);
    const old = describeResult({ id: "anova2-unbalanced", data: { table, ss_type: 3, a_levels: [], b_levels: [], cell_counts: [], balanced: true, n_obs: 6, alpha: 0.05 } }, ["y", "fa", "fb"], 0.05);
    expect(old.tables).toHaveLength(1);
  });
});
