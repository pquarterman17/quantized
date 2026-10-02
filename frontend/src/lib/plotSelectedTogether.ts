// Eager entry for "Plot selected together" (the palette/menu command, the
// Library context menu, import-batch offers, ROI batch): the body lives in
// lib/plotSelectedTogetherRun.ts and loads on first use, off the eager bundle.

import { onLoadFailure, runLazy } from "./runLazy";

/** Combine `ids` into one overlay plot, one curve per dataset — see
 *  lib/plotSelectedTogetherRun.ts. A failed chunk load is toasted. */
export function plotSelectedTogether(ids: readonly string[]): Promise<void> {
  return runLazy("Loading overlay…", () => import("./plotSelectedTogetherRun")).then(
    (m) => m.plotSelectedTogether(ids),
    onLoadFailure,
  );
}
