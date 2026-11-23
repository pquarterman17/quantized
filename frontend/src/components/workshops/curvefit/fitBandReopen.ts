// "Open in Curve Fit" for a fit band (lane RO3). A band is a statement about ONE
// fit: it needs that fit's covariance, free-parameter count, observation
// variance and data. The result records a digest of exactly those inputs
// (`fit`), and a reopened band may REPLACE its output only while the live fit
// hashes to the same digest; any other fit gets "Add as a new output" with the
// reason. Curve Fit has no editing session to seed, so reopening restores the
// band's level and prediction setting and the source, and asks for the fit again.

import { bandFitStats } from "./fitBandData";
import { dataFingerprint } from "../../../lib/dataFingerprint";
import type { ReopenSeed } from "../../../lib/committedOutputReopen";
import type { CalcResult } from "../../../lib/types";
import type { FittedData } from "../../../store/curveFitSession";

/** A content digest of the fit a band is drawn from. */
export function fitBandDigest(result: CalcResult, fit: FittedData): string {
  const stats = bandFitStats(result, fit.x);
  const params = (result.params as number[] | undefined) ?? [];
  const covar = (result.covar as number[][] | null | undefined) ?? [];
  const obsVar = stats.obs_var;
  const empty = { labels: [], units: [], metadata: {} };
  const points = dataFingerprint({
    ...empty, time: [...fit.x], values: fit.y.map((y, i) => [y, obsVar?.[i] ?? Number.NaN]),
  });
  const model = dataFingerprint({
    ...empty, time: [...params, stats.n_points, stats.n_free, stats.mse ?? Number.NaN], values: covar.map((row) => [...row]),
  });
  return `${points}-${model}`;
}

/** Why a reopened band cannot replace its output for the live fit (null: it can). */
export function fitBandReplaceBlock(seed: ReopenSeed | null, model: string, digest: string): string | null {
  if (!seed) return null;
  if (seed["model"] !== model) {
    return `The current fit is “${model}”, not the “${String(seed["model"])}” this band was drawn from, so the commit adds a new output.`;
  }
  if (seed["fit"] !== digest) {
    return "The current fit differs from the one this band was drawn from (its data, range, weights or parameters), so the commit adds a new output. Fit the recorded model on the recorded data and range again to replace it.";
  }
  return null;
}
