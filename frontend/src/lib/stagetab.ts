// Stage-tab routing for dataset activation — which stage tab (plot / map /
// worksheet) an activation lands on. Extracted from store/useApp.ts
// (MAIN_PLAN #2) so the window slice (store/windows.ts) can use
// `plotIntentStageTab` without a runtime store<->slice import cycle; useApp
// re-exports both, so existing `store/useApp` imports keep working.

import { is2DMap } from "./mapdata";
import type { Dataset } from "./types";

export type StageTab = "plot" | "map" | "worksheet";

/** Default stage tab for a newly-activated dataset: a 2-D map (XRDML RSM) opens
 *  in the Map view, a 1-D scan in the Plot view — but never override an explicit
 *  Worksheet choice (the user is inspecting the data grid). */
export function nextStageTab(d: Dataset, current: StageTab): StageTab {
  if (current === "worksheet") return current;
  return is2DMap(d.data) ? "map" : "plot";
}

/** Stage tab for a PLOT-INTENT action — applying an Origin figure or figure
 *  doc, "Plot (make active)", worksheet "Plot selection"/"Add to plot",
 *  GraphBuilder "Send to Stage" (owner 2026-07-09: "it's a bit confusing when
 *  I'm opening a plot... and have to remember to toggle up"). The complement
 *  of `nextStageTab`'s "stay on Worksheet" guard, which exists for passive/
 *  ambiguous activation (a fresh import, restoring a workspace) — these
 *  actions always mean "show me the plot", so a 2-D map dataset still opens
 *  the Map view (never regress that routing) but everything else FORCES
 *  "plot" regardless of which tab the user is currently on. */
export function plotIntentStageTab(d: Dataset): StageTab {
  return is2DMap(d.data) ? "map" : "plot";
}
