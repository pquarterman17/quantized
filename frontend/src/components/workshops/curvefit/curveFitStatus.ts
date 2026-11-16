// The one-line fit status in Curve Fit's sticky header (UX-F): what state the
// fit is in, in words, next to the Fit button that changes it -- so after a
// fit the outcome is readable without scrolling, the way OriginPro's NLFit
// keeps its status beside the persistent Fit/Done bar. Pure, for tests.
//
// A converged fit is not a good one (UX audit 8 #5): Lorentzian over a whole
// 3-peak Raman spectrum "fitted" one broad hump at R² 0.185 and the status
// read green. So a fit with R² < 0.5, or whose residuals fail the runs test
// at p < 0.01 (they keep one sign over long stretches: the model misses the
// data's shape), reads warn-tone "poor fit ... try a range" -- here and in
// the app's status line (`fittedStatus`).

import { normCdf } from "../../../lib/axisScales";
import { fmtR2, sigFigs } from "../../../lib/fitValueFormat";
import type { CalcResult } from "../../../lib/types";

export type FitStatusTone = "ok" | "warn" | "danger" | "dim";

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
}

export function curveFitStatus(i: FitStatusInput): { text: string; tone: FitStatusTone } {
  if (!i.hasData) return { text: "Select a dataset to fit", tone: "dim" };
  if (i.busy) return { text: i.guessing ? "Guessing start values…" : "Fitting…", tone: "dim" };
  if (i.error) return { text: "Failed — see the message below", tone: "danger" };
  if (i.byLevels > 0) return { text: i.byBusy ? `Fitting ${i.byLevels} levels…` : `${i.byLevels} per-level fits — see Results`, tone: "dim" };
  const r = i.result;
  if (!r) return { text: "Not fitted yet", tone: "dim" };
  if (i.guessOnly) return { text: "Start values guessed — press Fit", tone: "dim" };
  if (r.exitFlag === 0) return { text: "Did not converge — see Results", tone: "danger" };
  const stats = `R² ${fmtR2(r.R2)} · χ²/dof ${sigFigs(r.chiSqRed, 3)}`;
  if (i.stale) return { text: `Inputs changed — refit (${stats})`, tone: "warn" };
  const poor = poorFit(r);
  if (poor) return { text: `Fitted — poor fit (${poor}); try a range`, tone: "warn" };
  return { text: stats, tone: "ok" };
}

/** Below this R² a fit explains too little of the data to be the answer. */
export const POOR_R2 = 0.5;
/** A residual runs test failing at this level flags a systematic misfit. */
export const RUNS_ALPHA = 0.01;

/** Two-sided p of the Wald-Wolfowitz runs test on the residual signs (zero
 *  counts as positive), or null when it is undefined (fewer than 3 finite
 *  residuals, or all of one sign). The statistic Diagnostics reports
 *  (calc/fit_stats.py `residual_diagnostics`), computed here because the fit
 *  result already carries the residuals. */
export function runsTestP(residuals: readonly unknown[]): number | null {
  const pos = residuals.flatMap((v) => (typeof v === "number" && Number.isFinite(v) ? [v >= 0] : []));
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

/** Why a converged fit is a poor one ("R² 0.19", "residual runs p 3e-12"),
 *  or null when it is not. */
export function poorFit(r: CalcResult): string | null {
  // Once per result object: the panel asks on every render (status + offer).
  const known = verdicts.get(r);
  if (known !== undefined) return known;
  let why: string | null = null;
  if (typeof r.R2 === "number" && Number.isFinite(r.R2) && r.R2 < POOR_R2) why = `R² ${sigFigs(r.R2, 2)}`;
  else {
    const p = runsTestP(Array.isArray(r.residuals) ? r.residuals : []);
    if (p !== null && p < RUNS_ALPHA) why = `residual runs p ${sigFigs(p, 1)}`;
  }
  verdicts.set(r, why);
  return why;
}
const verdicts = new WeakMap<CalcResult, string | null>();

/** The app status line after a fit lands: warn-tone when the fit is poor. */
export function fittedStatus(model: string, dataset: string, r: CalcResult): [string, "ok" | "warn"] {
  const poor = poorFit(r);
  return poor ? [`fitted ${model} to ${dataset} — poor fit (${poor}); try a range`, "warn"] : [`fitted ${model} to ${dataset}`, "ok"];
}
