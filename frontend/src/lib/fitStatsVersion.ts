// Which DEFINITIONS produced a saved fit's statistics (fitting review item
// 10). The 2026-11 fitting audit changed what three reported numbers mean:
//
//            v1 (results saved before it)        v2 (current)
//   errors   Hessian of the weighted SSR         (JᵀWJ)⁻¹·s² — Origin / scipy
//   RMSE     √(Σ w r² / n), unitless if weighted √(Σ r² / n), in the units of y
//   AIC      no weight term                      + Σ ln w (statsmodels)
//
// A FitSpec records `statsVersion: 2` when the fitter said so; a spec without
// the field predates the change. Recomputing such a spec must not silently
// swap its numbers for differently-defined ones under the same labels, so
// every replay asks the route for the spec's OWN version (`stats_version: 1`
// for a legacy spec) until the user runs the explicit "Update statistics"
// action. Pure and tiny: the replay paths that import it are lazy.

import type { FitSpec } from "./types";

export const FIT_STATS_VERSION = 2;

/** The `/fit` request field that keeps a replayed spec on its own
 *  statistics: nothing for a current spec, `stats_version: 1` for a legacy
 *  one. `update` = the user asked to move this result to the current ones. */
export function statsVersionField(
  spec: Pick<FitSpec, "statsVersion"> | undefined,
  update = false,
): { stats_version?: 1 } {
  return update || spec?.statsVersion === FIT_STATS_VERSION ? {} : { stats_version: 1 };
}

/** The version a fitter response declares, or undefined when it says none. */
export function resultStatsVersion(result: Record<string, unknown>): 1 | 2 | undefined {
  return result.statsVersion === 2 ? 2 : result.statsVersion === 1 ? 1 : undefined;
}

export interface FitStatsLabels {
  legacy: boolean;
  /** One-line name of the statistics set, for the overview. */
  method: string;
  errors: string;
  rmse: string;
}

/** How to LABEL a saved fit's numbers, so old and new are never shown under
 *  the same words. */
export function fitStatsLabels(spec: Pick<FitSpec, "statsVersion" | "weight">): FitStatsLabels {
  if (spec.statsVersion === FIT_STATS_VERSION) {
    return {
      legacy: false,
      method: "Current (v2)",
      errors: "Covariance (JᵀWJ)⁻¹ · s²",
      rmse: "RMSE (y units)",
    };
  }
  return {
    legacy: true,
    method: "Legacy (v1, before 2026-11)",
    errors: "Hessian of the weighted SSR",
    rmse: spec.weight && spec.weight.mode !== "none" ? "RMSE (weighted, unitless)" : "RMSE (y units)",
  };
}
