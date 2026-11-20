// The dependency-free half of lib/linkedCurves.ts: what the EAGER code (the
// .dwk loader, the workspace merge, the stage, the export gate) needs of a live
// graph without pulling in the assembler. Pure; types only.

import type { Dataset } from "./types";

/** Why a live graph draws nothing: every curve is unresolved (deleted source,
 *  a cycle, a removed column), so the assembly has no rows. null otherwise.
 *  Such a graph never asks the backend for a plot or an export (a request
 *  with labels but no rows is a 422); the stage shows this instead. */
export const NO_CURVES_REASON = "No curves: their sources are missing";
export function emptyGraphReason(ds: Pick<Dataset, "linkedCurves" | "data">): string | null {
  return ds.linkedCurves && ds.data.time.length === 0 ? NO_CURVES_REASON : null;
}

/** Why an applied Origin graph draws nothing: it records curves, but none
 *  resolved to a column with data, so the apply left the plot EMPTY (`yKeys`
 *  is `[]`) instead of falling back to every channel (phantom curves). */
export const NO_RESOLVED_CURVES_REASON = "No curves: none of this graph's curves resolved to a column with data";

/** What a saved curve that cannot be restored is bound to: nothing. */
export const UNRESOLVED_SOURCE = "";

