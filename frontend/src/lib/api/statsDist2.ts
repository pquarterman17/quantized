// The marginal and ridgeline plots' endpoint wrappers (plan item 20), in their
// own file like `statsCdf.ts`; imported by path from the lazy Stat Stage only.

import type { MarginalEncodings, MarginalKind, MarginalWire } from "../statMarginal";
import type { RidgeBw, RidgelineWire } from "../statRidgeline";
import { postJSON } from "./http";

/** The complete (x, y) pairs, domains and each axis's marginal distribution
 *  (`calc.statplots_marginal.marginal_series`). */
export function statsMarginal(
  x: number[], y: number[], kind: MarginalKind, bins: string, encodings: MarginalEncodings = {},
): Promise<MarginalWire> {
  return postJSON("/api/statplots/marginal", { x, y, kind, bins, ...encodings });
}

/** One KDE curve per group (`calc.statplots_ridgeline.ridgeline_series`). */
export function statsRidgeline(groups: number[][], bw: RidgeBw): Promise<RidgelineWire> {
  return postJSON("/api/statplots/ridgeline", { groups, bw });
}
