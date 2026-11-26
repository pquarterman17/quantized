// Curve Fit batch, "Start each fit from the previous result" (pure).
// Mirrors calc/batch_fit.py `seed_from_previous`: the next worksheet starts
// from the previous fit's converged parameters, clamped into the bounds, with
// a held parameter at the panel's value. A fit that failed or did not
// converge hands nothing on, so the next worksheet uses the panel's starts.

import type { CalcResult } from "../../../lib/types";

export const SEED_FALLBACK_NOTE =
  "Did not converge: the next worksheet starts from the panel's start values.";

/** The fitted parameters when the fit converged (exitFlag 1) and every one is finite, else null. */
export function convergedParams(result: CalcResult, nParams: number): number[] | null {
  if (result.exitFlag !== 1 || !Array.isArray(result.params)) return null;
  const params = result.params as unknown[];
  if (params.length !== nParams) return null;
  return params.every((p) => typeof p === "number" && Number.isFinite(p)) ? (params as number[]) : null;
}

/** The start for the next fit: `prior` clamped into [lower, upper], each held
 *  parameter at the panel's start (`panel`). Bounds and holds are those of
 *  the edited parameter table; an untouched table has none. */
export function seedStarts(
  prior: readonly number[],
  panel: readonly number[] | undefined,
  lower: readonly (number | null)[] | undefined,
  upper: readonly (number | null)[] | undefined,
  fixed: readonly boolean[] | undefined,
): number[] {
  return prior.map((value, k) => {
    if (fixed?.[k] && panel?.[k] !== undefined) return panel[k]!;
    const lo = lower?.[k];
    const hi = upper?.[k];
    return Math.min(Math.max(value, typeof lo === "number" ? lo : -Infinity), typeof hi === "number" ? hi : Infinity);
  });
}
