// The lazy-only half of pointLabels.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the label-mode display names and the all-points cap. Only lazy modules and tests call it.
// The code moved here verbatim and pointLabels.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { PointLabelMode } from "./pointLabels";

export const POINT_LABEL_MODE_NAMES: Record<PointLabelMode, string> = {
  all: "All points (crowded ones thinned)",
  selected: "Selected rows",
  top: "Top N by |y|",
};

/** "All points" refuses above this many labelable points: past it a label per
 *  point is unreadable and the layout would cost a redraw's worth of time. */
export const MAX_ALL_POINTS = 2000;
