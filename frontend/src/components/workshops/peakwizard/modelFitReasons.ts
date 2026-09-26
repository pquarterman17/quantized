// Peak Analyzer — honest labels for a `/api/peaks/model-fit` result (audit
// P2.4 slice 2). Pure. Two jobs the results view must never get wrong:
//
// * WHY an error is missing. The backend reports `stderr: null` for a fixed
//   parameter, one that ended on a bound, one the data do not determine
//   (degenerate), and for EVERY parameter after a non-converged or deadline
//   stop (src/quantized/calc/peak_model_fit.py's header). A bare "—" would
//   hide which; the view shows the dash with this reason as its tooltip.
// * WHICH objective was minimised. `metrics.objective` is "chi2" only for a
//   weighted fit; an unweighted fit minimised SSR, and labelling that χ²
//   would claim a statistical meaning the number does not have.

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import { paramLabel } from "./peakModelParams";

/** What the reasons read: a live fit, or a batch row's fit (no curves). */
type Result = Pick<PeakModelFitResponse, "parameters" | "peaks" | "success">;
type ParamOut = Result["parameters"][number];
export type DerivedKey = "center" | "fwhm" | "height" | "area";

const NOT_CONVERGED = "not reported: the fit stopped without converging, so no error is meaningful";

/** Why `p.stderr` is null, or null when it is not. */
export function paramErrorReason(result: Result, p: ParamOut, depth = 0): string | null {
  if (p.stderr !== null) return null;
  if (!result.success) return NOT_CONVERGED;
  if (p.tie) {
    const target = result.parameters.find((q) => q.name === p.tie);
    const why = target && depth < 8 ? paramErrorReason(result, target, depth + 1) : null;
    return `tied to ${paramLabel(p.tie)}` + (why ? ` (${why})` : "");
  }
  if (!p.vary) return "fixed: not fitted, so it has no error";
  if (p.at_bound) return "on a bound: the error is not reported there";
  return "undetermined: the data do not pin this parameter down independently (fix or tie it)";
}

function fieldsFor(shape: string, key: DerivedKey): string[] {
  const widths = shape === "voigt" ? ["fwhm_g", "fwhm_l"] : ["fwhm"];
  if (key === "center" || key === "height") return [key];
  if (key === "fwhm") return widths;
  return ["height", ...widths, ...(shape === "pseudo_voigt" ? ["eta"] : [])];
}

/** Why peak `k`'s derived `key` has no error, or null when it has one. */
export function derivedErrorReason(result: Result, k: number, key: DerivedKey): string | null {
  const peak = result.peaks[k];
  if (!peak || peak[`${key}_stderr`] !== null) return null;
  if (!result.success) return NOT_CONVERGED;
  const rows = fieldsFor(peak.shape, key)
    .map((f) => result.parameters.find((q) => q.name === `p${k}.${f}`))
    .filter((q): q is ParamOut => q !== undefined);
  const fitted = rows.filter((q) => q.vary || q.tie);
  if (fitted.length === 0) return "fixed: every parameter it depends on is fixed";
  const missing = fitted.filter((q) => q.stderr === null);
  if (missing.length === 0) return "not available: the error did not evaluate to a finite number";
  return "not available: " + missing
    .map((q) => `${paramLabel(q.name)} ${paramErrorReason(result, q) ?? "has no error"}`)
    .join("; ");
}

/** The metrics block, the objective under its honest label first. */
export function metricRows(m: PeakModelFitResponse["metrics"]): [string, number | null][] {
  const objective: [string, number | null][] = m.objective === "chi2"
    ? [["χ²", m.chi2], ["reduced χ²", m.reduced_chi2]]
    : [["SSR", m.ssr], ["reduced SSR", m.reduced_ssr]];
  return [
    ...objective,
    ["R²", m.r_squared],
    ["adj. R²", m.adj_r_squared],
    ["AIC", m.aic],
    ["BIC", m.bic],
    ["points", m.n_points],
    ["free", m.n_free],
    ["dof", m.dof],
  ];
}
