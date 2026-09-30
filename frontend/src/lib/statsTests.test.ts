// Statistical-tests workshop — pure request building (lib/statsTests.ts).
import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, DEFAULT_SELECTION, STATS_TESTS, buildTestRequest, type TestSelection } from "./statsTests";
import type { DataStruct } from "./types";

// x = 1..6; ch0/ch1/ch2 continuous (ch1 has a NaN at row 2); ch3 = lot code
// (categorical, "L1"/"L2"); ch4 = temperature code ("hot"/"cold").
const data: DataStruct = {
  time: [1, 2, 3, 4, 5, 6],
  values: [
    [10, 20, 1.5, 0, 0],
    [11, 21, 2.5, 0, 1],
    [12, NaN, 2.0, 0, 0],
    [13, 23, 4.5, 1, 1],
    [14, 24, 3.0, 1, 0],
    [15, 26, 6.5, 1, 1],
  ],
  labels: ["a", "b", "c", "lot", "temp"],
  units: ["", "", "", "", ""],
  metadata: { x_column_name: "t" },
  cat_levels: { 3: ["L1", "L2"], 4: ["cold", "hot"] },
};

const sel = (over: Partial<TestSelection>): TestSelection => ({ ...DEFAULT_SELECTION, ...over });

describe("STATS_TESTS catalog", () => {
  it("lists the twelve wired tests, each with a one-sentence blurb", () => {
    expect(STATS_TESTS.map((t) => t.id)).toEqual([
      "anderson",
      "ks-normal",
      "ks-two-sample",
      "sign-test",
      "dunnett",
      "friedman",
      "anova-rm",
      "anova2-unbalanced",
      "regression-multi",
      "stepwise",
      "partial-correlation",
      "power",
    ]);
    for (const t of STATS_TESTS) expect(t.blurb.split(". ").length).toBe(1);
  });
});

describe("buildTestRequest", () => {
  it("sends one column's finite values for a normality test", () => {
    const out = buildTestRequest("anderson", data, sel({ x: 1 }), DEFAULT_PARAMS);
    expect(out).toEqual({ ok: true, request: { id: "anderson", body: { x: [20, 21, 23, 24, 26] } }, labels: ["b"] });
  });

  it("row-aligns a paired test, dropping rows where either value is missing", () => {
    const out = buildTestRequest("sign-test", data, sel({ x: 0, y: 1 }), { ...DEFAULT_PARAMS, alternative: "less" });
    expect(out).toEqual({
      ok: true,
      request: { id: "sign-test", body: { x: [10, 11, 13, 14, 15], y: [20, 21, 23, 24, 26], alternative: "less" } },
      labels: ["a", "b"],
    });
  });

  it("keeps independent samples unaligned for the two-sample KS test", () => {
    const out = buildTestRequest("ks-two-sample", data, sel({ x: 0, y: 1 }), DEFAULT_PARAMS);
    expect(out.ok && out.request.body).toEqual({
      x: [10, 11, 12, 13, 14, 15],
      y: [20, 21, 23, 24, 26],
      alternative: "two-sided",
    });
  });

  it("keeps the two-sample KS test two-sided (its one-sided forms compare CDFs)", () => {
    const out = buildTestRequest("ks-two-sample", data, sel({ x: 0, y: 1 }), { ...DEFAULT_PARAMS, alternative: "less" });
    expect(out.ok && out.request.body).toMatchObject({ alternative: "two-sided" });
  });

  it("builds Friedman treatments and repeated-measures subjects from complete rows", () => {
    const f = buildTestRequest("friedman", data, sel({ cols: [0, 1, 2] }), DEFAULT_PARAMS);
    expect(f.ok && f.request.body).toEqual({
      groups: [
        [10, 11, 13, 14, 15],
        [20, 21, 23, 24, 26],
        [1.5, 2.5, 4.5, 3.0, 6.5],
      ],
    });
    const rm = buildTestRequest("anova-rm", data, sel({ cols: [0, 2] }), { ...DEFAULT_PARAMS, alpha: 0.01 });
    expect(rm.ok && rm.request.body).toEqual({
      data: [[10, 1.5], [11, 2.5], [12, 2.0], [13, 4.5], [14, 3.0], [15, 6.5]],
      alpha: 0.01,
    });
  });

  it("builds Dunnett groups by category with the first level as the control", () => {
    const out = buildTestRequest("dunnett", data, sel({ x: 2, byCol: 3, groupMode: "category" }), DEFAULT_PARAMS);
    expect(out).toEqual({
      ok: true,
      request: {
        id: "dunnett",
        body: { groups: [[1.5, 2.5, 2.0], [4.5, 3.0, 6.5]], control: 0, alpha: 0.05, alternative: "two-sided" },
      },
      labels: ["lot = L1", "lot = L2"],
    });
  });

  it("sends two-way ANOVA factors as their level names", () => {
    const out = buildTestRequest("anova2-unbalanced", data, sel({ x: 1, byCol: 3, byCol2: 4 }), DEFAULT_PARAMS);
    expect(out).toEqual({
      ok: true,
      request: {
        id: "anova2-unbalanced",
        body: {
          values: [20, 21, 23, 24, 26],
          factor_a: ["L1", "L1", "L2", "L2", "L2"],
          factor_b: ["cold", "hot", "hot", "cold", "hot"],
          ss_type: 3,
          alpha: 0.05,
        },
      },
      labels: ["b", "lot", "temp"],
    });
  });

  it("builds a multiple regression from complete cases, x column included", () => {
    const out = buildTestRequest("regression-multi", data, sel({ x: 2, cols: [-1, 1] }), DEFAULT_PARAMS);
    expect(out).toEqual({
      ok: true,
      request: {
        id: "regression-multi",
        body: { y: [1.5, 2.5, 4.5, 3.0, 6.5], predictors: [[1, 2, 4, 5, 6], [20, 21, 23, 24, 26]], alpha: 0.05 },
      },
      labels: ["c", "t", "b"],
    });
  });

  it("never uses the response as its own predictor", () => {
    const out = buildTestRequest("stepwise", data, sel({ x: 0, cols: [0] }), DEFAULT_PARAMS);
    expect(out).toEqual({ ok: false, error: "Pick at least one predictor other than the response." });
  });

  it("explains what is missing instead of sending a doomed request", () => {
    expect(buildTestRequest("partial-correlation", data, sel({ cols: [0, 1] }), DEFAULT_PARAMS)).toEqual({
      ok: false,
      error: "Pick at least 3 columns.",
    });
    expect(buildTestRequest("ks-two-sample", data, sel({ x: 0, y: 0 }), DEFAULT_PARAMS)).toEqual({
      ok: false,
      error: "Pick two different columns.",
    });
    expect(buildTestRequest("anderson", null, DEFAULT_SELECTION, DEFAULT_PARAMS)).toEqual({
      ok: false,
      error: "Select a dataset to analyze.",
    });
  });

  it("plans a power study without any data, solving for n when n is blank", () => {
    const solve = buildTestRequest("power", null, DEFAULT_SELECTION, { ...DEFAULT_PARAMS, effectSize: 0.8, n: null });
    expect(solve.ok && solve.request.body).toEqual({
      effect_size: 0.8,
      power: 0.8,
      kind: "two-sample",
      alpha: 0.05,
      tails: 2,
    });
    const atN = buildTestRequest("power", null, DEFAULT_SELECTION, { ...DEFAULT_PARAMS, n: 12 });
    expect(atN.ok && atN.request.body).toMatchObject({ n: 12 });
  });
});
