// Statistical-tests workshop wrappers, part three (GAP_AUDIT_9 G6): Welch ANOVA,
// post hoc comparisons, variance tests, equivalence (TOST), tolerance intervals
// and proportion tests. Request shapes come from the generated OpenAPI schema;
// the routes return plain calc dicts (non-finite values arrive as null). Kept in
// its own file so api/statsTests.ts (the union and dispatcher) stays small.

import { postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

export interface WelchAnovaResult {
  F: number; df1: number; df2: number; p: number;
  /** Approximate effect size (provisional, owner to confirm). */
  omega_sq: number;
  alpha: number; significant: boolean; n_groups: number; N: number;
  groups: { index: number; n: number; mean: number; sd: number }[];
  classical_F: Num; classical_p: Num; method: string;
}

export interface PosthocPair {
  i: number; j: number; diff: number; p: number; ciLow: Num; ciHigh: Num;
  significant: boolean; effect_size: Num;
  /** Absent for Tukey (scipy returns no per-pair SE or df). */
  se?: number; statistic?: number; df?: number;
}

export interface PosthocResult {
  pairs: PosthocPair[]; n_groups: number; alpha: number; method: string;
  key: "tukey" | "games-howell" | "scheffe" | "lsd" | "dunn-sidak";
  omnibus_p: Num; adjusted: boolean;
  /** Dunn-Sidak only: what `diff` is the difference of. */
  diff_kind?: string;
  groups: { index: number; n: number; mean: number }[];
}

export interface VarianceTestResult {
  statistic: number; statistic_name: string; df1: number; df2: Num; p: number;
  significant: boolean; method: string; alpha: number; n_groups: number;
  groups: { index: number; n: number; variance: number }[];
  ratio?: number; ratio_ci_low?: number; ratio_ci_high?: number;
}

export interface TostResult {
  diff: number; se: number; df: number; low: number; high: number; alpha: number;
  t_lower: number; p_lower: number; t_upper: number; p_upper: number; p: number;
  ci_low: number; ci_high: number; ci_level: number; equivalent: boolean;
  effect_size: Num; method: string; design: string;
  n?: number; mean?: number; mu0?: number;
  n1?: number; n2?: number; mean1?: number; mean2?: number;
}

export interface ToleranceResult {
  n: number; mean: number; sd: number; coverage: number; confidence: number;
  sides: "two" | "upper" | "lower"; k: number; k_howe: Num;
  lower: Num; upper: Num; method: string;
}

export interface MoodMedianResult {
  statistic: number; df: number; p: number; grand_median: number; alpha: number;
  significant: boolean; n_groups: number; min_expected: number; method: string;
  groups: { index: number; n: number; above: number; below: number; median: number }[];
}

/** One- or two-sample exact Poisson rate test; `ci_high` is null when unbounded. */
export interface PoissonRateResult {
  samples: 1 | 2; x1: number; t1: number; rate1: number; rate0?: number;
  x2?: number; t2?: number; rate2?: number; ratio?: Num; ratio0?: number;
  p: number; ci_low: Num; ci_high: Num; alternative: string; alpha: number;
  significant: boolean; method: string;
}

export interface ToleranceNpResult {
  n: number; coverage: number; confidence: number; sides: "two" | "upper" | "lower";
  lower: Num; upper: Num; rank_from_each_end: number; achieved_confidence: number;
  extremes_confidence: number; min_n_extremes: number; method: string;
}

export interface BinomialResult {
  x: number; n: number; phat: number; p0: number; alternative: string; alpha: number;
  effect_size: number; p: number; statistic: Num; ci_low: number; ci_high: number;
  ci_method: string; method: string; significant: boolean;
}

export interface TwoProportionsResult {
  x1: number; n1: number; x2: number; n2: number; p1: number; p2: number; diff: number;
  statistic: number; p: number; ci_low: number; ci_high: number; ci_method: string;
  risk_ratio: Num; odds_ratio: Num; effect_size: number; alternative: string;
  alpha: number; significant: boolean; method: string;
}

export interface FisherResult {
  table: number[][]; p1: number; p2: number; p: number; odds_ratio: Num;
  sample_odds_ratio: Num; ci_low: Num; ci_high: Num; ci_method: string;
  effect_size: number; alternative: string; alpha: number; significant: boolean; method: string;
}

export const statsWelchAnova = (body: S["GroupTestRequest"], signal?: AbortSignal): Promise<WelchAnovaResult> =>
  postJSON("/api/stats/welch-anova", body, signal);
export const statsPosthoc = (body: S["PosthocRequest"], signal?: AbortSignal): Promise<PosthocResult> =>
  postJSON("/api/stats/posthoc", body, signal);
export const statsVarianceTest = (body: S["VarianceTestRequest"], signal?: AbortSignal): Promise<VarianceTestResult> =>
  postJSON("/api/stats/variance-test", body, signal);
export const statsTostOne = (body: S["TostOneRequest"], signal?: AbortSignal): Promise<TostResult> =>
  postJSON("/api/stats/tost-one", body, signal);
export const statsTostTwo = (body: S["TostTwoRequest"], signal?: AbortSignal): Promise<TostResult> =>
  postJSON("/api/stats/tost-two", body, signal);
export const statsToleranceInterval = (body: S["ToleranceRequest"], signal?: AbortSignal): Promise<ToleranceResult> =>
  postJSON("/api/stats/tolerance-interval", body, signal);
export const statsBinomialTest = (body: S["BinomialRequest"], signal?: AbortSignal): Promise<BinomialResult> =>
  postJSON("/api/stats/binomial-test", body, signal);
export const statsTwoProportions = (body: S["TwoCountsRequest"], signal?: AbortSignal): Promise<TwoProportionsResult> =>
  postJSON("/api/stats/two-proportions", body, signal);
export const statsFisher2x2 = (body: S["TwoCountsRequest"], signal?: AbortSignal): Promise<FisherResult> =>
  postJSON("/api/stats/fisher-2x2", body, signal);
export const statsMoodMedian = (body: S["GroupTestRequest"], signal?: AbortSignal): Promise<MoodMedianResult> =>
  postJSON("/api/stats/mood-median", body, signal);
export const statsPoissonRate = (body: S["PoissonRateRequest"], signal?: AbortSignal): Promise<PoissonRateResult> =>
  postJSON("/api/stats/poisson-rate", body, signal);
export const statsToleranceNp = (body: S["ToleranceNpRequest"], signal?: AbortSignal): Promise<ToleranceNpResult> =>
  postJSON("/api/stats/tolerance-interval-np", body, signal);
