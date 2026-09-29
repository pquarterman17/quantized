// Peak Analyzer model fit — per-point 1σ errors (`y_err`) for the working
// segment. The column is the one the curve-fit workshop's "Y error column"
// weighting uses: the view's `errKeys` entry for the primary fit channel,
// resolved through the shared `lib/fitweights.dyForFit`, so the two fits read
// the same sigmas with the same rules (|value|; a missing, zero or invalid
// column means unweighted, never fabricated sigmas).
//
// `kept` are the segment's ANALYSIS-view row indices (usePeakWizard's
// range cut + gap drop), which is exactly how `dyForFit`'s output is indexed.
// A baseline subtracted in step ① is deterministic, so it leaves σ unchanged.

import { dyForFit } from "../../../lib/fitweights";
import type { Dataset } from "../../../lib/types";

/** The fitted segment's σ, aligned with its x/y, or null to fit unweighted. */
export function segmentYErr(
  ds: Dataset | null | undefined,
  yKey: number,
  errKey: number | undefined,
  kept: readonly number[],
): number[] | null {
  if (errKey == null) return null;
  const { dy } = dyForFit(ds, yKey, { mode: "yerr", errKey });
  if (!dy) return null;
  const out = kept.map((i) => dy[i]);
  return out.every((v) => v !== undefined) ? out : null;
}
