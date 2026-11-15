// The two facts about an exported figure's analysis overlays that callers
// outside the (lazy) export path need -- lib/figureSpecOverlays appends them,
// store/analysisResultPlotOpen checks a built figure carries the fit. Kept
// dependency-free so asking does not pull the export stack into a chunk.

import type { FigureSpec } from "./api/figures";

/** The fit's series label on the wire, past the dataset's own columns. */
export const FIT_SERIES_LABEL = "fit";

/** A request shape a row-aligned overlay column can ride: not grouped,
 *  encoded, faceted or polar (their rows are re-split server-side). */
export function specCanCarryOverlays(spec: FigureSpec): boolean {
  return !spec.polar && !spec.facets && !spec.encoding && spec.group_col == null;
}
