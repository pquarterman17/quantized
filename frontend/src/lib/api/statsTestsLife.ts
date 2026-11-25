// Statistical-tests workshop wrappers, part five (GAP_AUDIT_9 G8): censored life
// distributions and Fit Life by X. Request shapes come from the generated
// OpenAPI schema; the routes return plain calc dicts (non-finite values arrive
// as null). `censor` follows JMP: 1 = censored, 0 = failed.

import { postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

export type LifeDist = "weibull" | "lognormal" | "exponential" | "loglogistic" | "sev";
export type LifeTransform = "arrhenius-celsius" | "arrhenius-kelvin" | "power" | "linear";

export interface LifeParameter { name: string; estimate: number; se: Num; ci_low: Num; ci_high: Num }
export interface LifeQuantile { p: number; time: number; ci_low: Num; ci_high: Num }
export interface LifeProbability { time: number; probability: number; ci_low: Num; ci_high: Num; reliability: number }
export interface LifeComparisonRow {
  distribution: LifeDist; loglik: Num; n_params: Num; aicc: Num; bic: Num;
  delta_aicc?: Num; delta_bic?: Num; note?: string;
}
export interface LifeKaplanMeier {
  times: number[]; survival: number[]; std_error: Num[]; ci_low: Num[]; ci_high: Num[];
  at_risk: number[]; events: number[]; median: Num; n: number; ci_method: string;
}
export interface LifePlot {
  dist: LifeDist; std: "sev" | "norm" | "logis"; x_log: boolean; method: string;
  points: { t: number; p: number; z: number }[];
  line: { t: number; z: number; z_low: number; z_high: number }[];
  ticks: { p: number; z: number }[];
}

export interface LifeDistributionResult {
  distribution: LifeDist; n: number; n_failed: number; n_censored: number; alpha: number; ci_method: string;
  parameters: LifeParameter[]; loglik: number; n_params: number; aicc: Num; bic: number;
  comparison: LifeComparisonRow[]; quantiles: LifeQuantile[]; probabilities: LifeProbability[];
  kaplan_meier: LifeKaplanMeier; plot: LifePlot;
}

export interface LifeTurnbull {
  lower: number[]; upper: Num[]; mass: number[]; cdf: number[]; survival: number[];
  n: number; converged: boolean; method: string;
}
/** Interval / left-censored fit (`/api/stats/life-interval`): the Turnbull estimate replaces Kaplan-Meier. */
export interface LifeIntervalResult extends Omit<LifeDistributionResult, "kaplan_meier" | "n_failed" | "n_censored"> {
  n_exact: number; n_interval: number; n_left: number; n_right: number; turnbull: LifeTurnbull;
}

export interface LifeByXResult {
  distribution: LifeDist; transform: LifeTransform; n: number; n_failed: number; n_censored: number;
  alpha: number; ci_method: string; parameters: LifeParameter[]; loglik: number; n_params: number;
  aicc: Num; bic: number;
  levels: { x: number; x_transformed: number; n: number; n_failed: number }[];
  use_x: Num; use_quantiles: LifeQuantile[];
  acceleration: { x: number; factor: number; ci_low: Num; ci_high: Num }[];
}

export const statsLifeDistribution = (body: S["LifeDistributionRequest"], signal?: AbortSignal): Promise<LifeDistributionResult> =>
  postJSON("/api/stats/life-distribution", body, signal);
export const statsLifeInterval = (body: S["LifeIntervalRequest"], signal?: AbortSignal): Promise<LifeIntervalResult> =>
  postJSON("/api/stats/life-interval", body, signal);
export const statsLifeByX = (body: S["LifeByXRequest"], signal?: AbortSignal): Promise<LifeByXResult> =>
  postJSON("/api/stats/life-by-x", body, signal);
