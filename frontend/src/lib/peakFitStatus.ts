// The one-line quality verdict of a simultaneous peak fit ("Fit all
// together", the Peak analyzer's step ④, the Library result's overview) —
// the Peaks counterpart of Curve Fit's `curveFitStatus`/`poorFit`
// (components/workshops/curvefit/curveFitStatus.ts, UX audit 8 lane D).
//
// UX audit 9 #3: the eval-limited MATLAB-parity simplex stopped at R² 0.942 on
// a Si XRD scan whose least-squares optimum is 0.998, and the result read as
// a green "Current" with no warning. The fit now polishes that simplex
// (calc/peak_multifit_polish.py), and this verdict reads warn-tone when:
//  * the polish did not converge (`converged === false`) — its last point is
//    shown, without uncertainties (this includes a fit stopped by the
//    request's time budget);
//  * RMSE > 3× the detector's white-noise estimate of the data
//    (`noiseSigma`, calc/peak_noise.estimate_noise) — the residual is
//    structure, not noise. This is the PRIMARY quality rule: the audit's scan,
//    correctly fitted, sits at 1.65× (a linear background under a decaying
//    one), so 3× leaves margin; and it is scale-free where R² is not;
//  * R² < 0.98 — ONLY as a fallback when there is no usable noise estimate
//    (`noiseSigma` missing, non-finite or not positive; the backend sends null
//    where the estimate is at its floor). R² misfires on correct fits to
//    low-count Poisson data: two Gaussians (heights 100/60, baseline 5) drawn
//    as poisson(0.1·true) over 600 points fit correctly at R² 0.74–0.79 yet
//    RMSE/noise 0.95–2.0.
// A record without the fields (a fit saved before they existed, an
// independent per-peak fit) is judged on what it has; with nothing to judge
// the tone is "ok" and the text the bare metrics.
//
// Pure lib — no store, no React.

import { fmtR2, sigFigs } from "./fitValueFormat";

/** Fallback only (no noise estimate): a simultaneous fit below this R² is flagged. */
export const PEAK_POOR_R2 = 0.98;
/** The primary rule: RMSE exceeding this multiple of the data's noise is flagged. */
export const PEAK_NOISE_RATIO = 3;

export interface PeakFitQualityInput {
  R2: number | null | undefined;
  rmse: number | null | undefined;
  converged?: boolean | null;
  noiseSigma?: number | null;
}

export interface PeakFitStatus {
  tone: "ok" | "warn";
  /** "R² 0.99768 · RMSE 19.9 (1.6× noise)", prefixed with the verdict when warn. */
  text: string;
  /** Each failed rule, in words; empty when the fit reads as good. */
  reasons: string[];
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function peakFitStatus(r: PeakFitQualityInput): PeakFitStatus {
  const reasons: string[] = [];
  const parts: string[] = [];
  if (fin(r.R2)) parts.push(`R² ${fmtR2(r.R2)}`);
  const ratio = fin(r.rmse) && fin(r.noiseSigma) && r.noiseSigma > 0 ? r.rmse / r.noiseSigma : null;
  if (fin(r.rmse)) parts.push(`RMSE ${sigFigs(r.rmse, 3)}${ratio === null ? "" : ` (${sigFigs(ratio, 2)}× noise)`}`);
  if (r.converged === false) reasons.push("did not converge");
  if (ratio !== null) {
    if (ratio > PEAK_NOISE_RATIO) reasons.push(`RMSE over ${PEAK_NOISE_RATIO}× noise`);
  } else if (fin(r.R2) && r.R2 < PEAK_POOR_R2) {
    reasons.push(`R² below ${PEAK_POOR_R2} (no noise estimate)`);
  }
  const metrics = parts.join(" · ");
  if (reasons.length === 0) return { tone: "ok", text: metrics, reasons };
  const verdict = r.converged === false
    ? "Did not converge — no uncertainties; check the seeds"
    : `Poor fit (${reasons.join(", ")}) — check the seeds, model and background`;
  return { tone: "warn", text: metrics ? `${verdict} · ${metrics}` : verdict, reasons };
}
