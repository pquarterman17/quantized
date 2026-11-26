// The one-line fit status in Curve Fit's sticky header (UX-F): what state the
// fit is in, in words, next to the Fit button that changes it -- so after a
// fit the outcome is readable without scrolling, the way OriginPro's NLFit
// keeps its status beside the persistent Fit/Done bar. Pure, for tests.
//
// A converged fit is not a good one (UX audit 8 #5): Lorentzian over a whole
// 3-peak Raman spectrum "fitted" one broad hump at R² 0.185 and the status
// read green. So a poor fit (`poorFit`) reads warn-tone "poor fit ... try a
// range" -- here and in the app's status line (`fittedStatus`):
//  * R² < 0.5 -- except a linear-family fit with no significant trend (its
//    overall F below ~4): fitting a line to see whether there IS a trend is
//    a right answer at R² ≈ 0;
//  * or residuals that fail the runs test at p < 0.01 TOGETHER with R² < 0.9.
//    The runs test alone is no verdict: correlated noise (any smoothed or
//    oversampled scan) fails it under the correct model -- 2000 points of
//    AR(0.3) noise read p ~ 1e-19 at R² 0.998.

import { normCdf } from "../../../lib/axisScales";
import { curveSourceOf, fullFitResult } from "../../../lib/fitCurve";
import { fmtR2, sigFigs } from "../../../lib/fitValueFormat";
import type { CalcResult } from "../../../lib/types";

export type FitStatusTone = "ok" | "warn" | "danger" | "dim";

/** What `poorFit` needs beyond the result: the model family and the fit's
 *  weights (a zero-weight point was not fitted). */
export interface FitContext {
  /** A linear-family model (Linear, polynomials). */
  linear?: boolean;
  /** A direct-weighted fit's weights, one per residual. */
  weights?: readonly (number | null)[] | null;
}

export interface FitStatusInput {
  hasData: boolean;
  busy: boolean;
  /** The running job is an auto-guess, not a fit. */
  guessing?: boolean;
  error: string | null;
  result: CalcResult | null;
  guessOnly: boolean;
  stale: boolean;
  /** Fitting per level of a "By" column (the results are in the Results tab),
   *  and whether those fits are still running. */
  byLevels: number;
  byBusy?: boolean;
  context?: FitContext;
  /** A finished line fit on errors in x and y (York / ODR), made in the Advanced tab. */
  lineFit?: { method: string; stale: boolean } | null;
}

export function curveFitStatus(i: FitStatusInput): { text: string; tone: FitStatusTone } {
  if (!i.hasData) return { text: "Select a dataset to fit", tone: "dim" };
  if (i.busy) return { text: i.guessing ? "Guessing start values…" : "Fitting…", tone: "dim" };
  if (i.error) return { text: "Failed — see the message below", tone: "danger" };
  if (i.byLevels > 0) return { text: i.byBusy ? `Fitting ${i.byLevels} levels…` : `${i.byLevels} per-level fits — see Results`, tone: "dim" };
  const r = i.result;
  if (!r && i.lineFit) {
    const { method, stale } = i.lineFit;
    return stale ? { text: `${method} line fit is out of date — refit`, tone: "warn" } : { text: `${method} line fit done — see Advanced`, tone: "ok" };
  }
  if (!r) return { text: "Not fitted yet", tone: "dim" };
  if (i.guessOnly) return { text: "Start values guessed — press Fit", tone: "dim" };
  if (r.exitFlag === 0) return { text: "Did not converge — see Results", tone: "danger" };
  const stats = `R² ${fmtR2(r.R2)} · χ²/dof ${sigFigs(r.chiSqRed, 3)}`;
  if (i.stale) return { text: `Inputs changed — refit (${stats})`, tone: "warn" };
  const poor = poorFit(r, i.context);
  if (poor) return { text: `Fitted — poor fit (${poor}); try a range`, tone: "warn" };
  return { text: stats, tone: "ok" };
}

/** Below this R² a fit explains too little of the data to be the answer. */
export const POOR_R2 = 0.5;
/** A residual runs test failing at this level flags a systematic misfit... */
export const RUNS_ALPHA = 0.01;
/** ...but only below this R²: on its own it flags correlated noise too. */
export const RUNS_R2 = 0.9;
/** A linear-family fit whose overall F is below this has no significant
 *  trend (the 5 % critical F is ~3.9 for one slope and many points). */
const NO_TREND_F = 4;

/** Two-sided p of the Wald-Wolfowitz runs test on the residual signs, or null
 *  when it is undefined (fewer than 3 residuals, or all of one sign) -- the
 *  statistic Diagnostics reports (calc/fit_stats.py `residual_diagnostics`),
 *  computed here because the fit result already carries the residuals, with
 *  that function's rules: with `weights`, only points with weight > 0 count;
 *  a missing or non-finite residual counts, as a negative sign (NaN >= 0 is
 *  false); zero is positive. */
export function runsTestP(residuals: readonly unknown[], weights?: readonly (number | null)[] | null): number | null {
  const use = weights && weights.length === residuals.length;
  const pos: boolean[] = [];
  residuals.forEach((v, i) => {
    if (use && !((weights[i] ?? Number.NaN) > 0)) return;
    pos.push(typeof v === "number" && v >= 0);
  });
  const n = pos.length;
  if (n < 3) return null;
  const nPos = pos.filter(Boolean).length;
  const nNeg = n - nPos;
  if (nPos < 1 || nNeg < 1) return null;
  const runs = 1 + pos.reduce((k, s, i) => (i > 0 && s !== pos[i - 1] ? k + 1 : k), 0);
  const mu = (2 * nPos * nNeg) / n + 1;
  const variance = (2 * nPos * nNeg * (2 * nPos * nNeg - n)) / (n * n * (n - 1));
  if (!(variance > 0)) return null;
  return 2 * normCdf(-Math.abs((runs - mu) / Math.sqrt(variance)));
}

/** A linear-family fit with no significant trend: overall F below ~4. */
function noTrend(r: CalcResult): boolean {
  const n = Number(r.nPoints);
  const p = Number(r.nFree);
  const r2 = Number(r.R2);
  if (!(n > p && p >= 2 && r2 < 1)) return false;
  return (r2 / (p - 1)) / ((1 - r2) / (n - p)) < NO_TREND_F;
}

/** Why a converged fit is a poor one ("R² 0.19", "R² 0.62, residual runs
 *  p 3e-12"), or null when it is not (the header doc's rules). */
export function poorFit(r: CalcResult, ctx: FitContext = {}): string | null {
  // Once per result and context: the panel asks on every render.
  const key = `${ctx.linear ? 1 : 0}${ctx.weights ? ctx.weights.length : ""}`;
  const known = verdicts.get(r)?.get(key);
  if (known !== undefined) return known;
  let why: string | null = null;
  const r2 = typeof r.R2 === "number" && Number.isFinite(r.R2) ? r.R2 : null;
  if (r2 !== null && r2 < POOR_R2 && !(ctx.linear && noTrend(r))) why = `R² ${sigFigs(r2, 2)}`;
  else if (r2 !== null && r2 < RUNS_R2) {
    const p = runsTestP(Array.isArray(r.residuals) ? r.residuals : [], ctx.weights);
    if (p !== null && p < RUNS_ALPHA) why = `R² ${sigFigs(r2, 2)}, residual runs p ${sigFigs(p, 1)}`;
  }
  const m = verdicts.get(r) ?? new Map<string, string | null>();
  m.set(key, why);
  verdicts.set(r, m);
  return why;
}
const verdicts = new WeakMap<CalcResult, Map<string, string | null>>();

/** The result `fittedStatus` should judge: a display-curve result (P4 phase 2,
 *  lib/fitCurve) carries no residuals, and only the runs test reads them, so
 *  it is fetched at full resolution only when that test can decide the
 *  verdict (POOR_R2 <= R² < RUNS_R2). A failed fetch judges by R² alone. */
export async function statusResult(r: CalcResult, y: readonly number[]): Promise<CalcResult> {
  const r2 = typeof r.R2 === "number" ? r.R2 : NaN;
  if (!curveSourceOf(r) || !(r2 >= POOR_R2 && r2 < RUNS_R2)) return r;
  return fullFitResult(r, y).catch(() => r);
}

/** The app status line after a fit lands: warn-tone when the fit is poor. */
export function fittedStatus(model: string, dataset: string, r: CalcResult, ctx?: FitContext): [string, "ok" | "warn"] {
  const poor = poorFit(r, ctx);
  return poor ? [`fitted ${model} to ${dataset} — poor fit (${poor}); try a range`, "warn"] : [`fitted ${model} to ${dataset}`, "ok"];
}

/** The model family `FitContext.linear` means: the registry's Linear
 *  category (Linear, Quadratic, Cubic, Poly 4) and Origin's polynomials. */
export const isLinearFamily = (category: string | undefined): boolean =>
  category === "Linear" || /^poly/i.test(category ?? "");
