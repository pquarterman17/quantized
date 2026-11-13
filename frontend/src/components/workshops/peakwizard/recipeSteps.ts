// Peak Analyzer — the recipe's step ① baseline and step ② peak find as plain
// async functions (audit P2.4 slice 4). The wizard's hooks (usePeakBaseline,
// usePeakCandidates) and the batch runner (peakBatchPrep.ts) call exactly
// these, so a batch row is prepared by the same requests the wizard makes on
// that dataset — one definition of "what the recipe's baseline / find mean".

import {
  baselineALS,
  baselineAnchor,
  baselineEstimate,
  baselineModPoly,
  baselineRegion,
  baselineRollingBall,
  baselineShirley,
} from "../../../lib/api/baseline";
import { findPeaks } from "../../../lib/api/peaks";
import type { PeakRecipe } from "../../../lib/peakwizard";
import type { Peak } from "../../../lib/types";

/** Anchor points at the given X positions, each at the trace's y at the
 *  nearest point (finite points only), sorted by x and de-duplicated. */
export function anchorsAt(x: readonly number[], y: readonly number[], at: readonly number[]): [number, number][] {
  // levels-allowlist: baseline anchor points on a continuous x axis, sorted
  // for interpolation — never a column's category levels.
  const out = new Map<number, number>();
  for (const a of at) {
    let best = -1;
    for (let i = 0; i < x.length; i++) {
      if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) continue;
      if (best < 0 || Math.abs(x[i]! - a) < Math.abs(x[best]! - a)) best = i;
    }
    if (best >= 0) out.set(x[best]!, y[best]!);
  }
  return [...out].sort((p, q) => p[0] - q[0]);
}

/** The recipe's auto-baseline over the working segment (x, y), or null when
 *  the recipe has none. The methods past the original three are the Baseline
 *  workshop's (useBaseline's callBaseline) on the same endpoints. */
export async function recipeBaseline(
  x: number[],
  y: number[],
  b: PeakRecipe["baseline"],
): Promise<(number | null)[] | null> {
  switch (b.method) {
    case "none":
      return null;
    case "als":
      return (await baselineALS({ y, lam: b.lam, p: b.p })).baseline;
    case "rollingball":
      return (await baselineRollingBall({ y, radius: b.radius })).baseline;
    case "modpoly":
      return (await baselineModPoly({ y, order: b.order })).baseline;
    case "snip":
      return (await baselineEstimate({ x, y, method: "snip" })).baseline;
    case "shirley":
      return (await baselineShirley({ x, y, max_iter: b.maxIter ?? 50 })).baseline;
    case "anchor": {
      const anchors = anchorsAt(x, y, b.anchorX ?? []);
      if (anchors.length < 2) throw new Error("anchor-point baseline needs at least two anchor X positions in the range");
      return (await baselineAnchor({ x, y, anchors, method: b.anchorMethod ?? "pchip" })).baseline;
    }
    case "poly": {
      const fx = x.filter(Number.isFinite);
      if (fx.length === 0) return null;
      const lo = fx.reduce((m, v) => (v < m ? v : m), Infinity);
      const hi = fx.reduce((m, v) => (v > m ? v : m), -Infinity);
      return (await baselineRegion({ x, y, x_min: lo, x_max: hi, order: b.order })).background;
    }
  }
}

/** The recipe's peak find over the (baseline-corrected) working trace. The
 *  Advanced fields (lib/peakwizard's `PeakFindAdvanced`) go on the wire only
 *  when the recipe carries them — a recipe from before they existed sends
 *  exactly what it always did, and the route's defaults stay in charge. */
export async function recipeFind(x: number[], y: number[], find: PeakRecipe["find"]): Promise<Peak[]> {
  const { snr_threshold, min_prominence, max_peaks, ...advanced } = find;
  const res = await findPeaks({
    x,
    y,
    snr_threshold,
    ...(min_prominence > 0 ? { min_prominence } : {}),
    max_peaks,
    ...advanced,
  });
  return res.peaks;
}
