// Statistical-tests workshop wrappers, part three: survival analysis
// (Kaplan-Meier, log-rank across groups, Cox proportional hazards). The routes
// return plain calc dicts (non-finite values, e.g. a median that is never
// reached, arrive as null). Request bodies for the first two are grouped
// client-side (one entry per group); the routes themselves take parallel lists.

import { postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

export interface SurvivalGroup {
  label: string;
  time: number[];
  /** 0 = censored, 1 = event. */
  event: number[];
}

/** One group (label "") when the curve is not split by a group column. */
export interface KaplanMeierBody {
  groups: SurvivalGroup[];
}

/** Two or more groups, compared with one log-rank test. */
export interface LogrankBody {
  groups: SurvivalGroup[];
}

export type CoxBody = S["CoxRequest"];

/** `/kaplan-meier` for one group. `times[0]` is 0 (everyone at risk). */
export interface KaplanMeierCurve {
  times: Num[];
  survival: Num[];
  ciLow: Num[];
  ciHigh: Num[];
  atRisk: Num[];
  events: Num[];
  /** null = never reached (the curve stays above 0.5). */
  medianSurvival: Num;
  medianCiLow: Num;
  medianCiHigh: Num;
  N: number;
}

export interface KaplanMeierResult {
  groups: { label: string; curve: KaplanMeierCurve }[];
}

export interface LogrankResult {
  statistic: Num;
  pValue: Num;
  dof: number;
  observed: number[];
  N: number[];
  /** Group names, in the order of `observed` / `N`. */
  labels: string[];
}

export interface CoxResult {
  coeffs: Num[];
  se: Num[];
  zStats: Num[];
  pValues: Num[];
  ciLow: Num[];
  ciHigh: Num[];
  concordanceIndex: Num;
  logLikelihood: Num;
  AIC: Num;
  N: number;
}

export async function statsKaplanMeier(body: KaplanMeierBody, signal?: AbortSignal): Promise<KaplanMeierResult> {
  const groups: KaplanMeierResult["groups"] = [];
  for (const g of body.groups) {
    const curve = await postJSON<KaplanMeierCurve>("/api/stats/kaplan-meier", { time: g.time, event: g.event }, signal);
    groups.push({ label: g.label, curve });
  }
  return { groups };
}

export async function statsLogrank(body: LogrankBody, signal?: AbortSignal): Promise<LogrankResult> {
  const res = await postJSON<Omit<LogrankResult, "labels">>(
    "/api/stats/logrank-groups",
    { times: body.groups.map((g) => g.time), events: body.groups.map((g) => g.event) },
    signal,
  );
  return { ...res, labels: body.groups.map((g) => g.label) };
}

export function statsCox(body: CoxBody, signal?: AbortSignal): Promise<CoxResult> {
  return postJSON("/api/stats/cox-ph", body, signal);
}
