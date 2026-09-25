// Peak Analyzer — the recipe's step ① baseline and step ② peak find as plain
// async functions (audit P2.4 slice 4). The wizard's hooks (usePeakBaseline,
// usePeakCandidates) and the batch runner (peakBatchPrep.ts) call exactly
// these, so a batch row is prepared by the same requests the wizard makes on
// that dataset — one definition of "what the recipe's baseline / find mean".

import { baselineALS, baselineModPoly, baselineRollingBall } from "../../../lib/api/baseline";
import { findPeaks } from "../../../lib/api/peaks";
import type { PeakRecipe } from "../../../lib/peakwizard";
import type { Peak } from "../../../lib/types";

/** The recipe's auto-baseline over `y` (the working segment's y), or null
 *  when the recipe has none. */
export async function recipeBaseline(
  y: number[],
  b: PeakRecipe["baseline"],
): Promise<(number | null)[] | null> {
  if (b.method === "none") return null;
  const res = await (b.method === "als"
    ? baselineALS({ y, lam: b.lam, p: b.p })
    : b.method === "rollingball"
      ? baselineRollingBall({ y, radius: b.radius })
      : baselineModPoly({ y, order: b.order }));
  return res.baseline;
}

/** The recipe's peak find over the (baseline-corrected) working trace. */
export async function recipeFind(x: number[], y: number[], find: PeakRecipe["find"]): Promise<Peak[]> {
  const res = await findPeaks({
    x,
    y,
    snr_threshold: find.snr_threshold,
    ...(find.min_prominence > 0 ? { min_prominence: find.min_prominence } : {}),
    max_peaks: find.max_peaks,
  });
  return res.peaks;
}
