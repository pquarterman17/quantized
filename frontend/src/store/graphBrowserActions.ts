// The writes behind the Graph browser's scroller and filter (gap plan item
// 22), kept out of the panel's hook. Both go through existing paths: the view
// history (`recordView`) and the Data Filter (`setDatasetFilter`).

import { fixedLim } from "../lib/axisLim";
import { scrolledWindow, type Extent, type ScrollKind } from "../lib/axisScroll";
import type { FilterPlan } from "../lib/graphFilter";
import { toast } from "./toasts";
import { useApp } from "./useApp";

export type ScrollAxisName = "x" | "y" | "y2";
type S = ReturnType<typeof useApp.getState>;
/** The view limits one scroll run can change; `y2Lim` only when the plot has a Y2 axis. */
type Lims = { xLim: S["xLim"]; yLim: S["yLim"]; y2Lim?: S["y2Lim"] };
let dragFrom: Lims | null = null;

/** How `axis` of the live view is laid out (an unset Y2 scale is linear). */
export const scrollKindOf = (s: Pick<S, "xScale" | "yScale" | "y2Scale">, axis: ScrollAxisName): ScrollKind => {
  const scale = axis === "x" ? s.xScale : axis === "y" ? s.yScale : s.y2Scale;
  return scale === "log" || scale === "reciprocal" ? scale : "linear";
};
const limsOf = (s: S): Lims => ({ xLim: s.xLim, yLim: s.yLim, ...(s.y2Keys?.length ? { y2Lim: s.y2Lim } : {}) });

/** Move the zoomed window of `axis` to slider position `t` within `extent`, live (no history yet). */
export function scrollAxisTo(axis: ScrollAxisName, extent: Extent, t: number): void {
  const s = useApp.getState();
  const lim = fixedLim(axis === "x" ? s.xLim : axis === "y" ? s.yLim : s.y2Lim);
  if (!lim) return;
  dragFrom ??= limsOf(s);
  const win = scrolledWindow(lim, extent, t, scrollKindOf(s, axis)); // a log or reciprocal axis scrolls in its own space
  useApp.setState(axis === "x" ? { xLim: win } : axis === "y" ? { yLim: win } : { y2Lim: win });
}

/** The drag or key run is over: it becomes ONE view-history step (Back view undoes it all). */
export function endAxisScroll(): void {
  const before = dragFrom;
  dragFrom = null;
  if (!before) return;
  const s = useApp.getState();
  s.recordView(before, limsOf(s));
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
