// Tiny eager encoder for the quick-fit gadget. Keep the heavier selection and
// subset replay code in fitselection.ts behind the lazy analysis seams.

import type { FitSpec } from "./types";

/** Encode a saved fit recipe into a pipeline step. Result fields are omitted:
 * a step describes what to run, not the prior run's output. The user's start
 * values, bounds and held flags ride along; `p0: null` says the starts were
 * the model's defaults, so a step recorded before this field existed (no `p0`
 * key) can be told apart from an untouched fit (lib/pipeline.ts's script). */
export function fitStepParams(model: string, spec: FitSpec): Record<string, unknown> {
  const params: Record<string, unknown> = { model, p0: spec.p0 ?? null };
  if (spec.yKey !== undefined) {
    params.yKey = spec.yKey;
    if (spec.xKey !== undefined) params.xKey = spec.xKey;
  }
  for (const k of ["range", "rowIds", "sourceRowCount", "rowXFingerprint", "nPoints", "lower", "upper", "fixed"] as const)
    if (spec[k] != null) params[k] = spec[k];
  if (spec.weight && spec.weight.mode !== "none") params.weight = spec.weight;
  if (spec.statsVersion === 2) params.statsVersion = 2;
  return params;
}
