// Statistical-tests workshop — result tables + plain-language interpretation
// (lib/statsTestsResults.ts).
import { describe, expect, it } from "vitest";

import type { MultiRegressionResult } from "./api/statsTests";
import { describeResult, fmtP, outputToCSV, outputToTSV } from "./statsTestsResults";

const KS2 = { D: 0.5, p: 0.03, n1: 8, n2: 9, alternative: "two-sided", method: "Kolmogorov-Smirnov (two-sample)" };

const REG: MultiRegressionResult = {
  coeffs: [-0.05, 1.52, -0.34],
  se: [0.5, 0.43, 0.42],
  tStats: [-0.1, 3.55, -0.82],
  pValues: [0.92, 0.016, 0.45],
  ciLow: [-1.36, 0.42, -1.41],
  ciHigh: [1.25, 2.62, 0.73],
  R2: 0.989,
  R2adj: 0.984,
  fStat: 217.5,
  fPvalue: 1.4e-5,
  RMSE: 0.35,
  residuals: [],
  yFit: [],
  N: 8,
  df: 5,
  alpha: 0.05,
};

describe("fmtP", () => {
  it("rounds to two significant figures and floors tiny values", () => {
    expect(fmtP(0.0312)).toBe("p = 0.031");
    expect(fmtP(0.42384)).toBe("p = 0.42");
    expect(fmtP(3e-7)).toBe("p < 0.0001");
    expect(fmtP(null)).toBe("p = —");
  });
});

describe("describeResult", () => {
  it("says the distributions differ when p is below alpha", () => {
    const out = describeResult({ id: "ks-two-sample", data: KS2 }, ["a", "b"], 0.05);
    expect(out.sentence).toBe("p = 0.03: the distributions of a and b differ at the 5% level.");
    expect(out.tables[0].rows).toContainEqual(["D", 0.5]);
  });

  it("says there is no evidence of a difference when p is above alpha", () => {
    const out = describeResult({ id: "ks-two-sample", data: { ...KS2, p: 0.42 } }, ["a", "b"], 0.05);
    expect(out.sentence).toBe("p = 0.42: no evidence the distributions of a and b differ at the 5% level.");
  });

  it("reads Anderson-Darling against its 5% critical value", () => {
    const out = describeResult(
      {
        id: "anderson",
        data: {
          A2: 0.9,
          critical_values: [0.497, 0.559, 0.666, 0.773, 0.917],
          significance_levels_pct: [15, 10, 5, 2.5, 1],
          reject_at_5pct: true,
          N: 20,
          method: "Anderson-Darling (normal)",
        },
      },
      ["thickness"],
      0.05,
    );
    expect(out.sentence).toBe("A² = 0.9 exceeds the 5% critical value 0.666: thickness is not normally distributed.");
    expect(out.tables[1].columns).toEqual(["significance level (%)", "critical value"]);
  });

  it("names the groups that differ from the Dunnett control", () => {
    const out = describeResult(
      {
        id: "dunnett",
        data: {
          comparisons: [
            { group: 1, diff: 2, statistic: 3.1, p: 0.01, ciLow: 0.5, ciHigh: 3.5, significant: true },
            { group: 2, diff: 0.1, statistic: 0.2, p: 0.9, ciLow: -1, ciHigh: 1.2, significant: false },
          ],
          control: 0,
          alpha: 0.05,
          alternative: "two-sided",
          method: "Dunnett",
        },
      },
      ["as-grown", "anneal 300C", "anneal 500C"],
      0.05,
    );
    expect(out.sentence).toBe("1 of 2 groups differ from the control as-grown at the 5% level: anneal 300C.");
    expect(out.tables[0].columns).toEqual(["group", "diff vs control", "statistic", "p", "CI low", "CI high", "significant"]);
    expect(out.tables[0].rows[0]).toEqual(["anneal 300C", 2, 3.1, 0.01, 0.5, 3.5, "yes"]);
  });

  it("summarizes a two-way ANOVA by term", () => {
    const row = (source: string, p: number | null) => ({ source, SS: 1, df: 1, MS: 1, F: p == null ? null : 2, p });
    const out = describeResult(
      {
        id: "anova2-unbalanced",
        data: {
          table: [row("A", 0.001), row("B", 0.3), row("AxB", 0.04), row("Error", null), row("Total", null)],
          ss_type: 3,
          a_levels: ["L1", "L2"],
          b_levels: ["cold", "hot"],
          cell_counts: [[2, 2], [2, 2]],
          balanced: true,
          n_obs: 8,
          alpha: 0.05,
        },
      },
      ["Hc", "lot", "temp"],
      0.05,
    );
    expect(out.sentence).toBe("At the 5% level lot (p = 0.001) and lot × temp (p = 0.04) affect Hc; temp does not.");
    expect(out.tables[0].rows.map((r) => r[0])).toEqual(["lot", "temp", "lot × temp", "Error", "Total"]);
  });

  it("labels regression terms by column and states overall significance", () => {
    const out = describeResult({ id: "regression-multi", data: REG }, ["Tc", "thickness", "strain"], 0.05);
    expect(out.sentence).toBe(
      "R² = 0.989, overall p < 0.0001: the predictors explain Tc at the 5% level; significant terms: thickness.",
    );
    expect(out.tables[0].rows.map((r) => r[0])).toEqual(["(intercept)", "thickness", "strain"]);
  });

  it("interprets the paired, blocked, selection and correlation tests", () => {
    const sign = describeResult(
      { id: "sign-test", data: { n_pos: 0, n_neg: 8, n: 8, p: 0.0078, alternative: "two-sided", method: "sign" } },
      ["before", "after"],
      0.05,
    );
    expect(sign.sentence).toBe("p = 0.0078: before and after differ systematically at the 5% level.");
    expect(sign.tables[0].rows.slice(0, 2)).toEqual([["before > after", 0], ["before < after", 8]]);

    const friedman = describeResult(
      { id: "friedman", data: { chi2: 1.2, p: 0.55, df: 2, n_treatments: 3, n_blocks: 8, method: "Friedman" } },
      ["a", "b", "c"],
      0.05,
    );
    expect(friedman.sentence).toBe("p = 0.55: no evidence the 3 conditions differ across 8 blocks at the 5% level.");

    const rm = describeResult(
      {
        id: "anova-rm",
        data: {
          table: [{ source: "Conditions", SS: 15.8, df: 2, MS: 7.9, F: 60.5, p: 1.3e-7 }],
          n_subjects: 8,
          n_conditions: 3,
          grand_mean: 4.6,
          alpha: 0.05,
          partial_eta_sq: 0.9,
          sphericity: { greenhouse_geisser: 0.69, huynh_feldt: 0.81, p_greenhouse_geisser: 0.02, p_huynh_feldt: 0.01 },
        },
      },
      ["a", "b", "c"],
      0.01,
    );
    expect(rm.sentence).toBe("Greenhouse-Geisser p = 0.02: no evidence the means of a, b and c differ at the 1% level.");

    const step = describeResult(
      {
        id: "stepwise",
        data: {
          selected: [1],
          criterion: "bic",
          criterion_value: -3,
          direction: "backward",
          history: [{ action: "start", index: null, criterion: 5 }, { action: "drop", index: 0, criterion: -3 }],
          model: { ...REG, coeffs: [0.1, 2], R2: 0.95 },
          n_candidates: 2,
        },
      },
      ["Tc", "thickness", "strain"],
      0.05,
    );
    expect(step.sentence).toBe("Backward BIC selection keeps 1 of 2 predictors: strain (R² = 0.95).");
    expect(step.tables[2].rows).toEqual([["start", "—", 5], ["drop", "thickness", -3]]);

    const pc = describeResult(
      { id: "partial-correlation", data: { r: [[1, 0.2, -0.9], [0.2, 1, 0.1], [-0.9, 0.1, 1]], N: 12, controlled: 1 } },
      ["a", "b", "c"],
      0.05,
    );
    expect(pc.sentence).toBe("Strongest partial correlation: a and c, r = -0.9, holding the 1 other column fixed (N = 12).");
  });

  it("answers both power questions in one sentence", () => {
    const power = describeResult(
      { id: "power", data: { power: 0.693, effect_size: 0.8, n: 20, kind: "two-sample", alpha: 0.05, tails: 2 } },
      [],
      0.05,
    );
    expect(power.sentence).toBe(
      "With n = 20 per group, a two-sided two-sample t-test has 69% power to detect d = 0.8 at the 5% level.",
    );
    const n = describeResult(
      {
        id: "power",
        data: { n: 26, achieved_power: 0.807, target_power: 0.8, effect_size: 0.8, kind: "paired", alpha: 0.05, tails: 1 },
      },
      [],
      0.05,
    );
    expect(n.sentence).toBe(
      "A one-sided paired t-test needs n = 26 pairs for 80% power to detect d = 0.8 at the 5% level (achieves 81%).",
    );
  });
});

describe("table export", () => {
  it("copies every table as TSV and exports RFC-4180 CSV", () => {
    const out = describeResult({ id: "regression-multi", data: REG }, ["Tc", "thick, nm", "strain"], 0.05);
    const tsv = outputToTSV(out);
    expect(tsv.split("\n")[0]).toBe(out.sentence);
    expect(tsv).toContain("term\tcoefficient\tSE\tt\tp\tCI low\tCI high");
    expect(tsv).toContain("thick, nm\t1.52\t0.43\t3.55\t0.016\t0.42\t2.62");
    const csv = outputToCSV(out);
    expect(csv).toContain('"thick, nm",1.52,0.43,3.55,0.016,0.42,2.62');
  });
});
