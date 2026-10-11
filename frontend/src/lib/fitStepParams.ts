// Tiny eager encoder for the quick-fit gadget. Keep the heavier selection and
// subset replay code in fitselection.ts behind the lazy analysis seams.

import type { FitSpec } from "./types";

/** Encode a saved fit recipe into a pipeline step. Result fields are omitted:
 * a step describes what to run, not the prior run's output. */
export function fitStepParams(model: string, spec: FitSpec): Record<string, unknown> {
  const params: Record<string, unknown> = { model };
  if (spec.yKey !== undefined) {
    params.yKey = spec.yKey;
    if (spec.xKey !== undefined) params.xKey = spec.xKey;
  }
  if (spec.range) params.range = spec.range;
  if (spec.rowIds) params.rowIds = spec.rowIds;
  if (spec.sourceRowCount !== undefined) params.sourceRowCount = spec.sourceRowCount;
  if (spec.nPoints !== undefined) params.nPoints = spec.nPoints;
  if (spec.weight && spec.weight.mode !== "none") params.weight = spec.weight;
  return params;
}
