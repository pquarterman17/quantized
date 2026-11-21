// Lean curve-fit transport (P4 large-payload lane, plans/LARGE_PAYLOAD_PLAN.md;
// backend routes/_fitresults.py). Curve Fit workshop only: import it from
// lazy code, never from an eager module (the eager bundle has no headroom).
//
// A fit asked with `return_residuals: false` leaves the per-point `residuals`
// off the wire (20 MB of JSON at 1M rows) and returns a `resultId` that
// /api/fitting/diagnostics takes instead of y + residuals (39 MB up). The
// residuals are exactly `y - yFit` on the server (calc.fitting.curve_fit), and
// one IEEE-754 subtraction of the same two doubles is the same double here, so
// `withResiduals` restores them bit for bit: every consumer (write-to-sheet,
// report, residual plots, status) keeps reading `result.residuals`.

import type { CalcResult } from "./types";

/** `result` with `residuals` rebuilt as `y - yFit` when the server left them
 *  out. Non-finite on the server is null on the wire, so a null `yFit` (or a
 *  non-finite difference) is null here too. A result that already has
 *  residuals, or whose `yFit` does not align with `y`, is returned as is. */
export function withResiduals(result: CalcResult, y: readonly number[]): CalcResult {
  const yFit = result.yFit;
  if (Array.isArray(result.residuals) || !Array.isArray(yFit) || yFit.length !== y.length) return result;
  const residuals = y.map((v, i) => {
    const f = yFit[i];
    const d = typeof f === "number" ? v - f : Number.NaN;
    return Number.isFinite(d) ? d : null;
  });
  return { ...result, residuals };
}

/** Run `fit` lean and restore the residuals from the posted `y`. */
export async function leanFit<R extends { y: number[]; return_residuals?: boolean }>(
  fit: (req: R) => Promise<CalcResult>,
  req: R,
): Promise<CalcResult> {
  return withResiduals(await fit({ ...req, return_residuals: false }), req.y);
}
