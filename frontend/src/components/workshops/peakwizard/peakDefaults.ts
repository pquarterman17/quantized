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
//  * Step ③'s starting shape (UX audit 8 #5): pseudo-Voigt on an XRD or
//    Raman trace -- the shape those fields fit -- Gaussian otherwise.

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import { techniqueOf } from "../../../lib/techniqueDefaults";
import type { Dataset } from "../../../lib/types";
import type { PeakBaselineMethod, PeakRecipe } from "../../../lib/peakwizard";
import type { PeakRecipeFit } from "../../../lib/peakRecipeFit";
import { backgroundFromDegree, type ModelParam } from "./peakModelParams";

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

/** Does the trace decay as X increases? Read in X order: an ascending scan
 *  as is, a descending one reversed, and a non-monotonic X (a hysteresis
 *  loop, a swept-back scan) never -- "decays" means nothing there. Medians
 *  of five equal chunks (peaks barely move a median) never rise by more than
 *  5 % and the last is at most two thirds of the first. */
export function decays(x: readonly number[], y: readonly number[]): boolean {
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) pairs.push([x[i]!, y[i]!]);
  }
  if (pairs.length < 20) return false;
  const up = pairs.every((p, i) => i === 0 || p[0] >= pairs[i - 1]![0]);
  const down = pairs.every((p, i) => i === 0 || p[0] <= pairs[i - 1]![0]);
  if (up === down) return false; // non-monotonic (or a constant X)
  const v = (up ? pairs : [...pairs].reverse()).map((p) => p[1]);
  const k = v.length / 5;
  const m = [0, 1, 2, 3, 4].map((i) => median(v.slice(Math.round(i * k), Math.round((i + 1) * k))));
  if (!(m[4]! > 0)) return false;
  return m.every((val, i) => i === 0 || val <= m[i - 1]! * 1.05) && m[4]! * 1.5 <= m[0]!;
}

/** The step-① baseline to start from on this trace, or null to keep "none". */
export function suggestedBaseline(x: readonly number[], y: readonly number[], yLog: boolean): PeakBaselineMethod | null {
  return yLog || decays(x, y) ? "snip" : null;
}

/** Step ③'s background rule: with a baseline subtracted and no background
 *  picked (`fit.background` null), the wizard fits none. A SAVED recipe always
 *  carries its background explicitly (see `savedFit` / `loadedRecipe`), so
 *  the batch runner, which reads null as the recipe's degree, fits the same. */
export const backgroundDropped = (fit: PeakRecipeFit, baselineOn: boolean): boolean =>
  baselineOn && fit.background === null;

/** The fit section the wizard's model engine actually fits. */
export function effectiveFit(fit: PeakRecipeFit, baselineOn: boolean): PeakRecipeFit {
  return backgroundDropped(fit, baselineOn) ? { ...fit, background: "none" } : fit;
}

/** The recipe as saved: its effective background made explicit. */
export const savedFit = (r: PeakRecipe): PeakRecipeFit => effectiveFit(r.fit, r.baseline.method !== "none");

/** A loaded recipe whose background is unset keeps the meaning it was saved
 *  with (the recipe's degree), never the newer "none over a baseline" rule. */
export function loadedRecipe(r: PeakRecipe): PeakRecipe {
  return r.fit.background === null ? { ...r, fit: { ...r.fit, background: backgroundFromDegree(r.model.bgDegree) } } : r;
}

/** XRD / Raman evidence in a name, an axis label or a unit. */
const XRD_RAMAN = /(^|[^a-z])xrd([^a-z]|$)|x-?ray diffr|2\s*θ|2\s*-?theta|two.?theta|raman/i;

/** The peak shape step ③ starts from on this dataset: pseudo-Voigt for XRD
 *  powder and spectroscopy (Raman) techniques, Gaussian otherwise. A plain
 *  .xy / .csv / .txt import is tagged generic, so the dataset's name and its
 *  plotted X label and unit are read for the same evidence. */
export function defaultPeakShape(ds: Dataset, xKey: number | null): "Pseudo-Voigt" | "Gaussian" {
  const t = techniqueOf(ds);
  if (t === "xrd.powder" || t === "spectroscopy") return "Pseudo-Voigt";
  const d = ds.data;
  const meta = d.metadata ?? {};
  const x = xKey === null
    ? `${String(meta["x_column_name"] ?? "")} ${String(meta["x_column_unit"] ?? "")}`
    : `${d.labels[xKey] ?? ""} ${d.units[xKey] ?? ""}`;
  return XRD_RAMAN.test(`${ds.name} ${x}`) ? "Pseudo-Voigt" : "Gaussian";
}

/** Free parameters of a model table (varying, untied). */
export const freeCount = (params: readonly ModelParam[]): number => params.filter((p) => p.vary && !p.tie).length;

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
