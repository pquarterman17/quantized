// Peak Analyzer — turn a `/api/peaks/model-fit` result into the dataset's
// DURABLE peak table (lib/peakTable.ts; audit P2.1 "per-peak fit
// uncertainties"). Pure: no store, no React, no fetch.
//
// TWO HALVES, ONE SEAM. This file is the STATIC half: the wizard imports it
// for the Publish button's check and builds the whole table DRAFT here — every
// row and every provenance field that comes from the fit. The LAZY half,
// ./modelFitPublishRun (loaded on Publish), only mints ids, carries the prior
// table's exclusions (lib/peakTableFit) and writes through the store with the
// live-dataset stamp (store/peakTablePublish). The split is a bundle boundary,
// measured 2026-09-25 against the eager entry (865,631 B): importing
// lib/peakTableFit and the store writer statically put two more chunks in the
// wizard's preload list (+3 B); a lazy half that imported anything from THIS
// chunk made the entry re-export the wizard (`.then(e=>e.t)`, +13 B). With
// the draft built here and the lazy half importing only types from it, the
// entry is byte-identical. Keep this file free of VALUE imports from
// lib/peakTable and lib/peakTableFit, and keep the runner free of value
// imports from the wizard.
//
// This is WIRING, not numerics. Every number in the table is one the backend
// already returned — the derived centre / FWHM / height / area and their
// delta-method standard errors (calc/peak_model_fit.py, pinv covariance in
// calc/_bounded_lsq.py) — with two exceptions, both plain algebra on returned
// parameters, never a new estimate:
//   * `bg` (the background UNDER each peak, which the table's `height` is
//     measured above): the fitted polynomial evaluated at the centre, plus the
//     recipe's step-① baseline there when the fit ran on the subtracted trace
//     (`offsetAt`), so `height + bg` is the apex on the RAW data exactly as
//     for the classic producer;
//   * `bgCoeffs`: the polynomial in (x - x_ref) re-expanded into powers of x,
//     the classic producer's convention (ascending c0, c1, ...) — but ONLY
//     when the fit ran on the raw trace. After a step-① baseline subtraction
//     the polynomial describes the subtracted trace, so evaluating it would
//     disagree with every row's `bg` by the baseline; the coefficients are
//     then left empty (`bgDegree` still names the polynomial) and the engine
//     line says the fit ran after baseline subtraction.
//
// THE ERROR RULE. A standard error enters the table only when it is finite
// and > 0. The backend reports null for a fixed parameter, one on a bound,
// an undetermined one, and every one after a non-converged stop; a 0 would
// claim an exactly-known value. Each null keeps WHY in `errReasons`, from
// ./modelFitReasons — the same text the results view shows on hover.
//
// WHAT IS REFUSED (`modelFitPublishBlock`): no fit, a stale one (the
// parameter table changed since), a non-converged one, and any peak missing a
// centre / FWHM / height / area — a table row the user would then need to
// explain is worse than no row.

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import type { PeakErrKey, PeakTableEntry, PeakTableProvenance } from "../../../lib/peakTable";
import type { PeakRecipe } from "../../../lib/peakwizard";
import { derivedErrorReason } from "./modelFitReasons";
import { paramLabel } from "./peakModelParams";

/** What the table is built from — a live fit or a batch row's (no curves). */
export type PublishableFit = Pick<
  PeakModelFitResponse,
  "parameters" | "peaks" | "success" | "background" | "metrics" | "n_evaluations"
>;

export function paramValue(res: PublishableFit, name: string): number | null {
  const v = res.parameters.find((q) => q.name === name)?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The background polynomial's coefficients in (x - x_ref), c0 first; null
 *  when any is not a finite number. */
export function bgShifted(res: PublishableFit): number[] | null {
  const names = res.parameters.map((q) => q.name).filter((n) => /^bg\.c\d+$/.test(n));
  names.sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const c = names.map((n) => paramValue(res, n));
  return c.every((v): v is number => v !== null) ? c : null;
}

/** Why this fit cannot be published, or null. `stale` is the caller's: the
 *  parameter table changed since the fit. */
export function modelFitPublishBlock(res: PublishableFit | null, stale = false): string | null {
  if (!res) return "fit the model first";
  if (stale) return "the parameters changed since this fit — Re-fit before publishing";
  if (!res.success) return "the fit did not converge — its values and errors are not reportable";
  if (res.peaks.length === 0) return "the fit has no peaks";
  for (let k = 0; k < res.peaks.length; k++) {
    const missing = KEYS.find((key) => typeof res.peaks[k][key] !== "number" || !Number.isFinite(res.peaks[k][key]));
    if (missing) return `peak ${k + 1} has no finite ${missing === "fwhm" ? "FWHM" : missing}`;
  }
  if (!bgShifted(res)) return "the fitted background coefficients are not finite";
  return null;
}


/** The provenance fields stamped from the LIVE dataset at write time
 *  (store/peakTablePublish.ts), not from the fit. */
export type StampedField = "datasetId" | "datasetName" | "wavelengthA" | "xLabel" | "xUnit" | "fingerprint";

/** Everything the fit decides; the lazy half adds ids, exclusions and stamp. */
export interface ModelFitDraft {
  rows: Omit<PeakTableEntry, "id" | "excluded">[];
  provenance: Omit<PeakTableProvenance, StampedField>;
}

export interface ModelFitDraftOptions {
  recipe?: Pick<PeakRecipe, "name" | "range" | "baseline"> | null;
  /** The step-① baseline at x, when the fit ran on the subtracted trace. */
  offsetAt?: ((x: number) => number) | null;
  now?: Date;
}

const SHAPE_NAME: Record<string, string> = {
  gaussian: "Gaussian", lorentzian: "Lorentzian", pseudo_voigt: "Pseudo-Voigt", voigt: "Voigt",
};
const KEYS: readonly PeakErrKey[] = ["center", "fwhm", "height", "area"];
const NOT_POSITIVE = "not available: the reported error was not a positive finite number";

function shapeName(shape: string): string {
  return SHAPE_NAME[shape] ?? shape;
}

/** Σ c_k (x - r)^k re-expanded as Σ a_j x^j (binomial theorem), a0 first. */
export function shiftedToRaw(c: readonly number[], r: number): number[] {
  const a = c.map(() => 0);
  for (let k = 0; k < c.length; k++) {
    let binom = 1; // C(k, j), built up as j runs 0..k
    for (let j = 0; j <= k; j++) {
      a[j] += c[k] * binom * (-r) ** (k - j);
      binom = (binom * (k - j)) / (j + 1);
    }
  }
  return a;
}

function stderrOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** One durable row per fitted peak — without id / exclusion, which depend on
 *  the table it joins. Call only when `modelFitPublishBlock` is null. */
export function modelFitRows(
  res: PublishableFit,
  offsetAt?: ((x: number) => number) | null,
): Omit<PeakTableEntry, "id" | "excluded">[] {
  const c = bgShifted(res) ?? [];
  const r = res.background.x_ref;
  return res.peaks.map((p, k) => {
    const value = (key: PeakErrKey): number => p[key] as number;
    const center = value("center");
    const t = center - r;
    const bg = c.reduce((sum, ck, i) => sum + ck * t ** i, 0) + (offsetAt?.(center) ?? 0);
    const errs = {} as Record<PeakErrKey, number | null>;
    const errReasons: Partial<Record<PeakErrKey, string>> = {};
    for (const key of KEYS) {
      const raw = p[`${key}_stderr`];
      errs[key] = stderrOf(raw);
      if (errs[key] === null) errReasons[key] = derivedErrorReason(res, k, key) ?? NOT_POSITIVE;
    }
    const row: Omit<PeakTableEntry, "id" | "excluded"> = {
      center,
      centerErr: errs.center,
      fwhm: value("fwhm"),
      fwhmErr: errs.fwhm,
      height: value("height"),
      heightErr: errs.height,
      area: value("area"),
      areaErr: errs.area,
      bg,
      eta: p.shape === "pseudo_voigt" ? paramValue(res, `p${k}.eta`) : null,
      model: shapeName(p.shape),
      status: "fitted(model)",
    };
    if (p.shape === "voigt") {
      row.fwhmG = paramValue(res, `p${k}.fwhm_g`);
      row.fwhmL = paramValue(res, `p${k}.fwhm_l`);
    }
    if (Object.keys(errReasons).length > 0) row.errReasons = errReasons;
    return row;
  });
}

function recipeSummary(recipe: ModelFitDraftOptions["recipe"]): string | undefined {
  if (!recipe) return undefined;
  const { lo, hi } = recipe.range;
  const range = lo === null && hi === null ? "full range" : `x ${lo ?? "min"} to ${hi ?? "max"}`;
  return `${recipe.name ? `"${recipe.name}" · ` : ""}${range} · baseline ${recipe.baseline.method}`;
}

/** The table draft for a publishable fit (`modelFitPublishBlock` null). */
export function modelFitDraft(res: PublishableFit, opts: ModelFitDraftOptions = {}): ModelFitDraft {
  const shapes = [...new Set(res.peaks.map((p) => shapeName(p.shape)))];
  const ties = res.parameters.filter((q) => q.tie).map((q) => `${paramLabel(q.name)} → ${paramLabel(q.tie ?? "")}`);
  const c = bgShifted(res) ?? [];
  const m = res.metrics;
  const chi2 = m.objective === "chi2";
  const recipe = recipeSummary(opts.recipe);
  return {
    rows: modelFitRows(res, opts.offsetAt),
    provenance: {
      method: "simultaneous",
      model: shapes.join(" + "),
      bgDegree: c.length - 1,
      linkMode: ties.length > 0 ? `tied: ${ties.join(", ")}` : "None",
      constrain: false,
      bgCoeffs: opts.offsetAt ? [] : shiftedToRaw(c, res.background.x_ref),
      R2: m.r_squared,
      rmse: null,
      fittedAt: (opts.now ?? new Date()).toISOString(),
      producer: "model_fit",
      engine: `mixed-shape model fit · ${res.background.kind} background` +
        (opts.offsetAt ? " after baseline subtraction" : "") + ` · ${res.n_evaluations} evaluations`,
      ...(recipe ? { recipe } : {}),
      objective: {
        kind: chi2 ? "chi2" : "ssr",
        value: chi2 ? m.chi2 : m.ssr,
        reduced: chi2 ? m.reduced_chi2 : m.reduced_ssr,
      },
    },
  };
}

/** `ys` at `x` for `offsetAt`: linear between the first pair of consecutive
 *  finite points that brackets `x` (no sort order assumed), else the nearest
 *  finite point, else 0. */
export function interpolateAt(xs: readonly number[], ys: readonly (number | null)[], x: number): number {
  let prev = -1;
  let nearest = -1;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y === null || y === undefined || !Number.isFinite(y) || !Number.isFinite(xs[i])) continue;
    if (nearest < 0 || Math.abs(xs[i] - x) < Math.abs(xs[nearest] - x)) nearest = i;
    if (prev >= 0 && xs[i] !== xs[prev] && (xs[prev] - x) * (xs[i] - x) <= 0) {
      const y0 = ys[prev] as number;
      return y0 + ((y - y0) * (x - xs[prev])) / (xs[i] - xs[prev]);
    }
    prev = i;
  }
  return nearest >= 0 ? (ys[nearest] as number) : 0;
}
