// Recompute-only FitSpec result stamping. The stale-fit runner has already
// crossed an async backend boundary when it loads this module, while the
// quick-fit gadget needs the rest of fitselection.ts at startup. Keeping the
// result replacement here avoids charging that startup path for replay-only
// work.

import type { CalcResult, FitSpec } from "./types";

/** Replace a saved fit's result snapshot and mark when it was regenerated. */
export function stampRecompute(
  spec: FitSpec,
  result: CalcResult,
  now: () => string = () => new Date().toISOString(),
): FitSpec {
  // A recompute replaces the prior result snapshot. Strip every old summary
  // before adding the new response so a backend that cannot report (for
  // example) covariance or AIC does not leave the old fit's value beside a
  // fresh timestamp.
  const {
    errors: _oldErrors,
    R2: _oldR2,
    RMSE: _oldRMSE,
    AIC: _oldAIC,
    chiSqRed: _oldChiSqRed,
    nFree: _oldNFree,
    uncertainty: _oldUncertainty,
    ...recipe
  } = spec;
  const params = result.params;
  if (!Array.isArray(params) ||
      !params.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("the fitter did not return finite parameter values");
  }
  const errors = result.errors;
  const validErrors = Array.isArray(errors) &&
    errors.length === params.length &&
    errors.every((v) => v === null || (typeof v === "number" && Number.isFinite(v)));
  const summaries = Object.fromEntries(
    (["R2", "RMSE", "AIC", "chiSqRed"] as const).flatMap((field) => {
      const value = result[field];
      return typeof value === "number" && Number.isFinite(value) ? [[field, value]] : [];
    }),
  ) as Pick<FitSpec, "R2" | "RMSE" | "AIC" | "chiSqRed">;
  return {
    ...recipe,
    recomputedAt: now(),
    params: params as number[],
    ...(validErrors
      ? { errors: errors as (number | null)[] }
      : {}),
    uncertainty: validErrors ? "covariance" : "none",
    ...summaries,
    ...(typeof result.nFree === "number" && Number.isInteger(result.nFree) && result.nFree >= 0
      ? { nFree: result.nFree }
      : {}),
    ...(typeof result.exitFlag === "number" ? { exitFlag: result.exitFlag } : {}),
  };
}
