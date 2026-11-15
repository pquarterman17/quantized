// Eager entries for "Plot selected together" (the palette/menu command, the
// Library context menu, import-batch offers, ROI batch) and "Add curve
// from…": the bodies live in lib/plotSelectedTogetherRun.ts and load on first
// use, off the eager bundle.

import { onLoadFailure, runLazy } from "./runLazy";

/** Combine `ids` into one live graph, one curve per dataset — see
 *  lib/plotSelectedTogetherRun.ts. A failed chunk load is toasted. */
export function plotSelectedTogether(ids: readonly string[]): Promise<void> {
  return runLazy("Loading overlay…", () => import("./plotSelectedTogetherRun")).then(
    (m) => m.plotSelectedTogether(ids),
    onLoadFailure,
  );
}

/** "Add curve from…": add a curve from another dataset to the focused graph,
 *  kept live — see lib/plotSelectedTogetherRun.ts. */
export function addCurveFrom(): Promise<void> {
  return runLazy("Loading graph tools…", () => import("./plotSelectedTogetherRun")).then(
    (m) => m.addCurveFrom(),
    onLoadFailure,
  );
}
