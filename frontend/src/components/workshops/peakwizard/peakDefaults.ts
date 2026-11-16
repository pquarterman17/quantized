// Peak Analyzer — the sensible defaults (UX audit 7 #8, lane UX-I). Pure rules
// the wizard applies so that Next → Next → Next → Fit on an ordinary pattern
// gives a converged, honest answer instead of 20 peaks + a linear background
// absorbing the low-angle hump into a 14° "peak 1":
//
//  * Step ①: an automatic baseline (SNIP, the XRD/XRF standard) when the plot
//    is log-Y or the trace decays — the cases where a sloping, curved
//    background is certain and a straight fitted line cannot follow it.
//  * Step ③: no extra fitted background once a baseline was subtracted (the
//    wizard's effective model, usePeakWizard), and a warning when the free-
//    parameter count makes the time limit likely.
//  * Step ④: the time limit, and which peaks "Fit the N strongest" keeps.

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import type { PeakBaselineMethod } from "../../../lib/peakwizard";

/** The model fit's time limit: `routes/peaks.py`'s `deadline_s` default (the
 *  wizard never sends one). */
export const MODEL_FIT_TIME_LIMIT_S = 10;

/** How many peaks "Fit the N strongest" keeps. */
export const STRONGEST_PEAKS = 8;

/** Above this many free parameters (or one per 50 points) a fit is likely to
 *  run into the time limit (62 free on a 6474-point XRD scan did). */
const MAX_FREE = 40;
const POINTS_PER_FREE = 50;

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Does the trace decay from its start to its end? Medians of five equal
 *  chunks (peaks barely move a median) never rise by more than 5 % and the
 *  last is at most two thirds of the first. */
export function decays(y: readonly number[]): boolean {
  const v = y.filter(Number.isFinite);
  if (v.length < 20) return false;
  const k = v.length / 5;
  const m = [0, 1, 2, 3, 4].map((i) => median(v.slice(Math.round(i * k), Math.round((i + 1) * k))));
  if (!(m[4]! > 0)) return false;
  return m.every((x, i) => i === 0 || x <= m[i - 1]! * 1.05) && m[4]! * 1.5 <= m[0]!;
}

/** The step-① baseline to start from on this trace, or null to keep "none". */
export function suggestedBaseline(y: readonly number[], yLog: boolean): PeakBaselineMethod | null {
  return yLog || decays(y) ? "snip" : null;
}

/** Is a model with `free` parameters over `points` points likely to hit the
 *  time limit? */
export function heavyModel(free: number, points: number): boolean {
  return free > MAX_FREE || free > points / POINTS_PER_FREE;
}

/** Step ③'s warning for a heavy model, or null. */
export function freeParamWarning(free: number, points: number): string | null {
  if (!heavyModel(free, points)) return null;
  return `${free} free parameters for ${points} points: a fit this large often stops at the `
    + `${MODEL_FIT_TIME_LIMIT_S} s time limit unconverged. Exclude weak peaks (step 2) or share widths.`;
}

/** Did this fit stop at the time limit rather than converge? */
export function stoppedAtTimeLimit(r: Pick<PeakModelFitResponse, "success" | "message"> | null): boolean {
  return !!r && !r.success && /time limit/.test(r.message);
}

/** Candidate indices to EXCLUDE so only the `n` tallest included peaks stay. */
export function weakerThanStrongest(cands: readonly { height: number; included: boolean }[], n: number): number[] {
  const inc = cands.flatMap((c, i) => (c.included ? [i] : []));
  const keep = new Set([...inc].sort((a, b) => cands[b]!.height - cands[a]!.height).slice(0, n));
  return inc.filter((i) => !keep.has(i));
}
