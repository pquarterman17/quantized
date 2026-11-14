// Eager entry for the live-graph actions (gap audit 2 #1): "Plot selected
// together" (the palette/menu command, the Library context menu, import-batch
// offers, ROI batch) and "Add curve from…". Both bodies load on first use
// from ONE chunk, lib/plotSelectedTogetherRun.ts, off the eager bundle.

import { onLoadFailure, runLazy } from "./runLazy";

const load = () => runLazy("Loading graph tools…", () => import("./plotSelectedTogetherRun"));

/** Combine `ids` into one live graph — see lib/plotSelectedTogetherRun.ts.
 *  A failed chunk load is toasted. */
export function plotSelectedTogether(ids: readonly string[]): Promise<void> {
  return load().then((m) => m.plotSelectedTogether(ids), onLoadFailure);
}

/** Install the live-graph sync (store/linkedCurvesSync.ts) once a loaded or
 *  appended workspace brings a graph in: it re-links (rebuilds) it. */
export function relinkGraphs(datasets: readonly { linkedCurves?: unknown }[]): void {
  if (datasets.some((d) => d.linkedCurves)) void load().then((m) => m.installLinkedCurvesSync(), onLoadFailure);
}

/** "Add curve from…" on the active graph — see lib/addCurveRun.ts. */
export function addCurveFrom(): Promise<void> {
  return load().then((m) => m.addCurveFrom(), onLoadFailure);
}
