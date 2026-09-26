// Peak Analyzer -> the durable peak table (audit P2.1 "Per-peak fit
// uncertainties", filled by the P2.4 model-fit engine). Pure: no React, no
// store, no fetch.
//
// The mixed-shape model fit (`/api/peaks/model-fit`, calc/peak_model_fit.py)
// already returns delta-method standard errors for each peak's centre / FWHM /
// height / area from its pinv covariance; this module only MAPS that tested
// output onto `PeakTable` rows. No new numerics: every number written here is
// a number the backend returned, except `bg` (the background under each
// centre: the fit's own background polynomial evaluated there, plus the
// step-① baseline at the nearest sample exactly as the wizard's markers read
// it — so `height + bg` is the apex on the PLOTTED trace, the contract
// `PeakTableEntry.height` documents) and `rmse` (`sqrt(ssr / n_points)`, the
// legacy `fit_multi_peak` definition).
//
// NULL STAYS NULL. A parameter the backend reports no error for (fixed, tied
// to one without, on a bound, undetermined, or every parameter after a
// non-converged stop) is `null` in the table, never 0 and never NaN, and the
// row carries modelFitReasons' explanation in `errReasons`. A non-converged
// fit is refused outright (`modelFitPublishProblem`): its values are the
// optimiser's last point, not a result, and the durable table feeds
// Williamson-Hall.

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import {
  PEAK_TABLE_VERSION,
  type PeakErrField,
  type PeakTable,
  type PeakTableEntry,
} from "../../../lib/peakTable";
import { carriedExclusions, nextPeakId, xChannelIdentity } from "../../../lib/peakTableFit";
import type { Dataset } from "../../../lib/types";
import { baselineValueAt } from "../../../lib/peakWizardApex";
import { wavelengthFromMetadata } from "../../../lib/xrdWavelength";
import { derivedErrorReason } from "./modelFitReasons";

/** What a publish reads: a live fit's result (its curves are not needed). */
export type PublishableFit = Pick<
  PeakModelFitResponse,
  "peaks" | "parameters" | "metrics" | "success" | "warnings" | "background"
>;

/** Everything about the fit that is not in the response itself. */
export interface ModelFitPublishContext {
  /** The x channel the fit ran on (null = the time axis). */
  xKey: number | null;
  /** The recipe name, or "" / null when the recipe was never saved. */
  recipe: string | null;
  /** The recipe's step-① baseline method ("none" = no baseline). */
  baseline: string;
  /** Per peak, the background under its centre on the plotted y
   *  (`peakBackgrounds`). */
  bgAtCenter: readonly number[];
  /** `peakDataFingerprint` of the dataset the fit RAN on. */
  fingerprint: string;
  /** Injected so tests are deterministic; defaults to `new Date()`. */
  now?: Date;
}

const DERIVED: readonly PeakErrField[] = ["center", "fwhm", "height", "area"];
const BG_DEGREE: Record<string, number> = { none: -1, constant: 0, linear: 1, quadratic: 2 };

/** The model's own background at `x`: `sum_k bg.c{k} * (x - x_ref)^k`, the
 *  exact form `calc/peak_model.py`'s `PeakModel.background` evaluates (no
 *  `bg.c*` parameters = the "none" background = 0). */
export function modelBackgroundAt(res: Pick<PeakModelFitResponse, "parameters" | "background">, x: number): number {
  const t = x - res.background.x_ref;
  let sum = 0;
  for (let k = 0; ; k++) {
    const c = res.parameters.find((q) => q.name === `bg.c${k}`);
    if (!c) return sum;
    sum += (c.value ?? 0) * t ** k;
  }
}

/** The background under each fitted centre, on the PLOTTED y: the model's
 *  background there plus the step-① baseline it was fitted over (`baseline`
 *  null = none subtracted), read at the nearest sample of `segmentX` exactly
 *  as the wizard's own markers read it (lib/peakWizardApex). A peak without a
 *  finite centre gets 0 (`modelFitPublishProblem` refuses such a fit). */
export function peakBackgrounds(
  res: Pick<PeakModelFitResponse, "peaks" | "parameters" | "background">,
  segmentX: readonly number[],
  baseline: readonly (number | null)[] | null,
): number[] {
  return res.peaks.map((p) =>
    p.center === null ? 0 : modelBackgroundAt(res, p.center) + baselineValueAt(p.center, segmentX, baseline));
}

/** Why this fit cannot become a durable table, or null when it can. */
export function modelFitPublishProblem(res: PublishableFit): string | null {
  if (!res.success) return "an unconverged fit is not a result — re-fit before publishing";
  if (res.peaks.length === 0) return "the fit has no peaks";
  for (let k = 0; k < res.peaks.length; k++) {
    const p = res.peaks[k];
    const bad = DERIVED.find((key) => p[key] === null || !Number.isFinite(p[key]));
    if (bad) return `peak ${k + 1}'s ${bad} is not a finite number`;
  }
  return null;
}

/** "gaussian", or "mixed (gaussian, voigt)" — the table's `model` summary. */
function modelLabel(shapes: readonly string[]): string {
  const unique = [...new Set(shapes)];
  return unique.length === 1 ? unique[0] : `mixed (${unique.join(", ")})`;
}

/** Build the durable table for `ds` from a converged model fit. The caller has
 *  checked `modelFitPublishProblem` (a null centre/FWHM/height/area would
 *  otherwise be written as 0). `prior` carries the user's exclusions across a
 *  re-publish, matched by peak identity exactly like a Peaks-workshop re-fit. */
export function peakTableFromModelFit(
  res: PublishableFit,
  ds: Pick<Dataset, "id" | "name" | "data">,
  ctx: ModelFitPublishContext,
  prior: PeakTable | null | undefined,
): PeakTable {
  const param = (name: string) => res.parameters.find((q) => q.name === name);
  const value = (name: string) => param(name)?.value ?? null;
  const err = (name: string) => param(name)?.stderr ?? null;
  const rows = res.peaks.map((p, k): PeakTableEntry => {
    const reasons: Partial<Record<PeakErrField, string>> = {};
    for (const key of DERIVED) {
      if (p[`${key}_stderr`] === null) reasons[key] = derivedErrorReason(res, k, key) ?? "no error reported";
    }
    const voigt = p.shape === "voigt";
    const pv = p.shape === "pseudo_voigt";
    return {
      id: nextPeakId(),
      center: p.center ?? 0,
      centerErr: p.center_stderr,
      fwhm: p.fwhm ?? 0,
      fwhmErr: p.fwhm_stderr,
      height: p.height ?? 0,
      heightErr: p.height_stderr,
      area: p.area ?? 0,
      areaErr: p.area_stderr,
      bg: ctx.bgAtCenter[k] ?? 0,
      eta: pv ? value(`p${k}.eta`) : null,
      etaErr: pv ? err(`p${k}.eta`) : null,
      fwhmG: voigt ? value(`p${k}.fwhm_g`) : null,
      fwhmGErr: voigt ? err(`p${k}.fwhm_g`) : null,
      fwhmL: voigt ? value(`p${k}.fwhm_l`) : null,
      fwhmLErr: voigt ? err(`p${k}.fwhm_l`) : null,
      model: p.shape,
      status: "fitted",
      excluded: false,
      errReasons: reasons,
    };
  });
  const carried = carriedExclusions({ peaks: rows }, prior);
  rows.forEach((r, i) => (r.excluded = carried[i]));
  const m = res.metrics;
  const kind = res.background.kind;
  return {
    version: PEAK_TABLE_VERSION,
    peaks: rows,
    provenance: {
      datasetId: ds.id,
      datasetName: ds.name,
      method: "simultaneous",
      model: modelLabel(res.peaks.map((p) => p.shape)),
      bgDegree: BG_DEGREE[kind] ?? -1,
      linkMode: "",
      constrain: false,
      bgCoeffs: [],
      R2: m.r_squared,
      rmse: m.ssr !== null && m.n_points > 0 ? Math.sqrt(m.ssr / m.n_points) : null,
      wavelengthA: wavelengthFromMetadata(ds.data.metadata),
      ...xChannelIdentity(ds.data, ctx.xKey),
      fingerprint: ctx.fingerprint,
      fittedAt: (ctx.now ?? new Date()).toISOString(),
      producer: "model_fit",
      engine: "peak_model_fit",
      recipe: ctx.recipe || null,
      objective: m.objective,
      ssr: m.ssr,
      chi2: m.objective === "chi2" ? m.chi2 : null,
      background: `${kind} background` + (ctx.baseline !== "none" ? ` after ${ctx.baseline} baseline` : ""),
      warnings: [...res.warnings],
    },
  };
}
