// Power / sample size solver and probability calculator wrappers
// (`/api/stats/power-solve`, `/api/stats/probability`). Only the lazy
// statspower panels import this, so none of it reaches the eager bundle.

import { getJSON, postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

export type PowerTest = "t-one-sample" | "t-paired" | "t-two-sample" | "anova" | "prop-one" | "prop-two" | "variance";
export type PowerSolveFor = "power" | "n" | "effect";

export type PowerSolveBody = S["PowerSolveRequest"];

export interface PowerSolveResult {
  test: PowerTest;
  solve: PowerSolveFor;
  alpha: number;
  tails: 1 | 2;
  effect_name: string;
  /** Cohen's d / f / h, or the variance ratio (the smallest one reaching the target when solving for it). */
  effect: number;
  /** The same effect on the other side of the null (variance ratio below 1), when it has one. */
  effect_alt: Num;
  p0: Num;
  p1: Num;
  p1_alt: Num;
  n: number;
  n2: Num;
  n_total: number;
  ratio: number;
  groups: Num;
  /** The power at exactly the reported whole-number sizes. */
  power: number;
  target_power: Num;
  notes: string[];
  curve: { n: Num[]; power: Num[] };
}

export interface DistInfo {
  id: string;
  label: string;
  params: string[];
  defaults: number[];
  discrete: boolean;
}

export interface ProbabilityResult {
  dist: string;
  label: string;
  params: Record<string, number>;
  discrete: boolean;
  /** Worksheet formulas giving the same values (`A` is the x column); null where the formula language has none. */
  formulas: Record<"pdf" | "cdf" | "sf" | "quantile", string | null>;
  x?: Num[];
  pdf?: Num[];
  cdf?: Num[];
  sf?: Num[];
  p?: Num[];
  quantile?: Num[];
}

export function statsPowerSolve(body: PowerSolveBody, signal?: AbortSignal): Promise<PowerSolveResult> {
  return postJSON("/api/stats/power-solve", body, signal);
}

export function statsProbability(body: S["ProbabilityRequest"], signal?: AbortSignal): Promise<ProbabilityResult> {
  return postJSON("/api/stats/probability", body, signal);
}

export function statsDistributions(): Promise<DistInfo[]> {
  return getJSON("/api/stats/probability/distributions");
}
