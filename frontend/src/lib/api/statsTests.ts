// Statistical-tests workshop wrappers — the twelve `/api/stats/*` routes that
// had no frontend caller until the "Statistical tests" workshop
// (components/workshops/statstests). A sibling of api/stats.ts rather than
// part of it: that file sits near the 500-line module ceiling, and only the
// lazy workshop imports this one, so none of it reaches the eager bundle.
//
// Request shapes come from the generated OpenAPI schema (`schema.d.ts`); the
// routes return plain calc dicts, so the response shapes are mirrored here
// (non-finite values arrive as null).

import { postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

/** One row of a classical ANOVA table (repeated-measures / two-way). */
export interface AnovaTableRow {
  source: string;
  SS: Num;
  df: Num;
  MS: Num;
  F: Num;
  p: Num;
}

export interface AndersonResult {
  A2: number;
  critical_values: number[];
  significance_levels_pct: number[];
  reject_at_5pct: boolean;
  N: number;
  method: string;
}

export interface KsNormalResult {
  D: number;
  p: number;
  loc: number;
  scale: number;
  params_estimated: boolean;
  N: number;
  method: string;
}

export interface KsTwoSampleResult {
  D: number;
  p: number;
  n1: number;
  n2: number;
  alternative: string;
  method: string;
}

export interface SignTestResult {
  n_pos: number;
  n_neg: number;
  n: number;
  p: number;
  alternative: string;
  method: string;
}

export interface FriedmanResult {
  chi2: number;
  p: number;
  df: number;
  n_treatments: number;
  n_blocks: number;
  method: string;
}

export interface RepeatedMeasuresResult {
  table: AnovaTableRow[];
  n_subjects: number;
  n_conditions: number;
  grand_mean: number;
  alpha: number;
  partial_eta_sq: Num;
  sphericity: {
    greenhouse_geisser: Num;
    huynh_feldt: Num;
    p_greenhouse_geisser: Num;
    p_huynh_feldt: Num;
  };
}

export interface DunnettComparison {
  group: number;
  diff: number;
  statistic: number;
  p: number;
  ciLow: Num;
  ciHigh: Num;
  significant: boolean;
}

export interface DunnettResult {
  comparisons: DunnettComparison[];
  control: number;
  alpha: number;
  alternative: string;
  method: string;
}

export interface TwoWayAnovaResult {
  table: AnovaTableRow[];
  ss_type: number;
  a_levels: string[];
  b_levels: string[];
  cell_counts: number[][];
  balanced: boolean;
  n_obs: number;
  alpha: number;
}

export interface MultiRegressionResult {
  coeffs: number[];
  se: Num[];
  tStats: Num[];
  pValues: Num[];
  ciLow: Num[];
  ciHigh: Num[];
  R2: Num;
  R2adj: Num;
  fStat: Num;
  fPvalue: Num;
  RMSE: Num;
  residuals: Num[];
  yFit: Num[];
  N: number;
  df: number;
  alpha: number;
}

export interface StepwiseResult {
  selected: number[];
  criterion: string;
  criterion_value: number;
  direction: string;
  history: { action: string; index: number | null; criterion: number }[];
  model: MultiRegressionResult;
  n_candidates: number;
}

export interface PartialCorrelationResult {
  r: Num[][];
  N: number;
  controlled: number;
}

/** `/api/stats/power` answers one of two questions: the power at a given n,
 *  or (n omitted) the n that reaches a target power. */
export type PowerResult =
  | { power: number; effect_size: number; n: number; kind: string; alpha: number; tails: number }
  | {
      n: number;
      achieved_power: number;
      target_power: number;
      effect_size: number;
      kind: string;
      alpha: number;
      tails: number;
    };

/** A fully built request: which test, and its schema-typed body. */
export type StatsTestRequest =
  | { id: "anderson"; body: S["OneSampleRequest"] }
  | { id: "ks-normal"; body: S["KSNormalRequest"] }
  | { id: "ks-two-sample"; body: S["TwoSampleRequest"] }
  | { id: "sign-test"; body: S["PairedOrOneSampleRequest"] }
  | { id: "friedman"; body: S["GroupsRequest"] }
  | { id: "anova-rm"; body: S["RepeatedMeasuresRequest"] }
  | { id: "dunnett"; body: S["PostHocRequest"] }
  | { id: "anova2-unbalanced"; body: S["Anova2UnbalancedRequest"] }
  | { id: "regression-multi"; body: S["MultiRegressionRequest"] }
  | { id: "stepwise"; body: S["StepwiseRequest"] }
  | { id: "partial-correlation"; body: S["PartialCorrelationRequest"] }
  | { id: "power"; body: S["PowerRequest"] };

export type StatsTestId = StatsTestRequest["id"];

/** A test's result, tagged with the test that produced it. */
export type StatsTestResult =
  | { id: "anderson"; data: AndersonResult }
  | { id: "ks-normal"; data: KsNormalResult }
  | { id: "ks-two-sample"; data: KsTwoSampleResult }
  | { id: "sign-test"; data: SignTestResult }
  | { id: "friedman"; data: FriedmanResult }
  | { id: "anova-rm"; data: RepeatedMeasuresResult }
  | { id: "dunnett"; data: DunnettResult }
  | { id: "anova2-unbalanced"; data: TwoWayAnovaResult }
  | { id: "regression-multi"; data: MultiRegressionResult }
  | { id: "stepwise"; data: StepwiseResult }
  | { id: "partial-correlation"; data: PartialCorrelationResult }
  | { id: "power"; data: PowerResult };

/** Anderson-Darling normality test (critical-value table, no p). */
export function statsAnderson(body: S["OneSampleRequest"], signal?: AbortSignal): Promise<AndersonResult> {
  return postJSON("/api/stats/anderson", body, signal);
}

/** One-sample Kolmogorov-Smirnov test against a normal distribution. */
export function statsKsNormal(body: S["KSNormalRequest"], signal?: AbortSignal): Promise<KsNormalResult> {
  return postJSON("/api/stats/ks-normal", body, signal);
}

/** Two-sample Kolmogorov-Smirnov test (do two samples share a distribution?). */
export function statsKsTwoSample(body: S["TwoSampleRequest"], signal?: AbortSignal): Promise<KsTwoSampleResult> {
  return postJSON("/api/stats/ks-two-sample", body, signal);
}

/** Exact-binomial sign test (paired, or one-sample vs mu). */
export function statsSignTest(body: S["PairedOrOneSampleRequest"], signal?: AbortSignal): Promise<SignTestResult> {
  return postJSON("/api/stats/sign-test", body, signal);
}

/** Friedman test: k treatments measured on the same n blocks. */
export function statsFriedman(body: S["GroupsRequest"], signal?: AbortSignal): Promise<FriedmanResult> {
  return postJSON("/api/stats/friedman", body, signal);
}

/** One-way repeated-measures ANOVA (rows = subjects, columns = conditions). */
export function statsAnovaRM(body: S["RepeatedMeasuresRequest"], signal?: AbortSignal): Promise<RepeatedMeasuresResult> {
  return postJSON("/api/stats/anova-rm", body, signal);
}

/** Dunnett many-to-one comparison against a control group. */
export function statsDunnett(body: S["PostHocRequest"], signal?: AbortSignal): Promise<DunnettResult> {
  return postJSON("/api/stats/dunnett", body, signal);
}

/** Two-way ANOVA with interaction from long-format columns (Type II/III SS). */
export function statsAnova2Unbalanced(body: S["Anova2UnbalancedRequest"], signal?: AbortSignal): Promise<TwoWayAnovaResult> {
  return postJSON("/api/stats/anova2-unbalanced", body, signal);
}

/** Multiple linear regression (intercept + k predictors) with inference. */
export function statsRegressionMulti(body: S["MultiRegressionRequest"], signal?: AbortSignal): Promise<MultiRegressionResult> {
  return postJSON("/api/stats/regression-multi", body, signal);
}

/** AIC/BIC stepwise predictor selection over multiple regression. */
export function statsStepwise(body: S["StepwiseRequest"], signal?: AbortSignal): Promise<StepwiseResult> {
  return postJSON("/api/stats/stepwise", body, signal);
}

/** Partial correlation of every pair, controlling for all other columns. */
export function statsPartialCorrelation(body: S["PartialCorrelationRequest"], signal?: AbortSignal): Promise<PartialCorrelationResult> {
  return postJSON("/api/stats/partial-correlation", body, signal);
}

/** t-test power at n, or the n needed for a target power. */
export function statsPower(body: S["PowerRequest"], signal?: AbortSignal): Promise<PowerResult> {
  return postJSON("/api/stats/power", body, signal);
}

/** Run a built request and tag the response with its test id. */
export async function runStatsTest(req: StatsTestRequest, signal?: AbortSignal): Promise<StatsTestResult> {
  switch (req.id) {
    case "anderson":
      return { id: req.id, data: await statsAnderson(req.body, signal) };
    case "ks-normal":
      return { id: req.id, data: await statsKsNormal(req.body, signal) };
    case "ks-two-sample":
      return { id: req.id, data: await statsKsTwoSample(req.body, signal) };
    case "sign-test":
      return { id: req.id, data: await statsSignTest(req.body, signal) };
    case "friedman":
      return { id: req.id, data: await statsFriedman(req.body, signal) };
    case "anova-rm":
      return { id: req.id, data: await statsAnovaRM(req.body, signal) };
    case "dunnett":
      return { id: req.id, data: await statsDunnett(req.body, signal) };
    case "anova2-unbalanced":
      return { id: req.id, data: await statsAnova2Unbalanced(req.body, signal) };
    case "regression-multi":
      return { id: req.id, data: await statsRegressionMulti(req.body, signal) };
    case "stepwise":
      return { id: req.id, data: await statsStepwise(req.body, signal) };
    case "partial-correlation":
      return { id: req.id, data: await statsPartialCorrelation(req.body, signal) };
    case "power":
      return { id: req.id, data: await statsPower(req.body, signal) };
  }
}
