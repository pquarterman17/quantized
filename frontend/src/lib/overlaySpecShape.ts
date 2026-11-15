// The two facts about an exported figure's analysis overlays that callers
// outside the (lazy) export path need -- lib/figureSpecOverlays appends them,
// store/analysisResultPlotOpen checks a built figure carries the fit. Kept
// dependency-free so asking does not pull the export stack into a chunk.
// It also owns the ONE sentence that says a figure left an overlay out, so
// Send to report (store/analysisResultActions) and Export / Copy figure
// (lib/overlayDropNotice) cannot drift apart in what they tell the user.

import type { FigureSpec } from "./api/figures";

/** The fit's series label on the wire, past the dataset's own columns. */
export const FIT_SERIES_LABEL = "fit";

/** A request shape a row-aligned overlay column can ride: not grouped,
 *  encoded, faceted or polar (their rows are re-split server-side). */
export function specCanCarryOverlays(spec: FigureSpec): boolean {
  return !spec.polar && !spec.facets && !spec.encoding && spec.group_col == null;
}

/** How the user reads each overlay series label. */
const OVERLAY_NAMES: Record<string, string> = { [FIT_SERIES_LABEL]: "fit", baseline: "baseline", peaks: "peak markers" };

/** Why a built figure lacks overlays the canvas draws (`labels`: their wire
 *  labels; default the fit alone, Send to report's case). */
export function overlaysNotCarriedReason(labels: readonly string[] = [FIT_SERIES_LABEL]): string {
  const names = labels.map((label) => OVERLAY_NAMES[label] ?? label);
  const joined = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `the figure does not carry the ${joined} (${names.length > 1 ? "their curves are" : "its curve is"} not drawn there, or the view splits or encodes series)`;
}
