// The writes behind the Graph browser's scroller and filter (gap plan item
// 22), kept out of the panel's hook. Both go through existing paths: the view
// history (`recordView`) and the Data Filter (`setDatasetFilter`).

import { fixedLim } from "../lib/axisLim";
import { scrolledWindow, type Extent } from "../lib/axisScroll";
import type { FilterPlan } from "../lib/graphFilter";
import { toast } from "./toasts";
import { useApp } from "./useApp";

let dragFrom: { xLim: ReturnType<typeof useApp.getState>["xLim"]; yLim: ReturnType<typeof useApp.getState>["yLim"] } | null = null;

/** Move the zoomed window of `axis` to slider position `t` within `extent`, live (no history yet). */
export function scrollAxisTo(axis: "x" | "y", extent: Extent, t: number): void {
  const s = useApp.getState();
  const lim = fixedLim(axis === "x" ? s.xLim : s.yLim);
  if (!lim) return;
  dragFrom ??= { xLim: s.xLim, yLim: s.yLim };
  useApp.setState(axis === "x" ? { xLim: scrolledWindow(lim, extent, t) } : { yLim: scrolledWindow(lim, extent, t) });
}

/** The drag or key run is over: it becomes ONE view-history step (Back view undoes it all). */
export function endAxisScroll(): void {
  const before = dragFrom;
  dragFrom = null;
  if (!before) return;
  const s = useApp.getState();
  s.recordView(before, { xLim: s.xLim, yLim: s.yLim });
}

/** Write a view-filter plan (lib/graphFilter.ts) onto the source sheets' Data Filters. */
export function applyViewFilter(plan: FilterPlan): boolean {
  if (!plan.ok) {
    toast(plan.why, "danger");
    return false;
  }
  const s = useApp.getState();
  for (const e of plan.edits) s.setDatasetFilter(e.datasetId, e.filter);
  s.endHistoryRun();
  s.setStatus(`${plan.summary} (Undo restores them; the Data Filter window edits the range)`);
  return true;
}
