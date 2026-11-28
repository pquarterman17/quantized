// The writes behind the Graph browser's scroller and filter (gap plan item
// 22), kept out of the panel's hook. Both go through existing paths: the view
// history (`recordView`) and the Data Filter (`setDatasetFilter`).

import { fixedLim } from "../lib/axisLim";
import { scrolledWindow, type Extent } from "../lib/axisScroll";
import { axisNumberOf, scrollKind, scrollLim, type ScrollAxisName } from "../lib/axisScrollAxes";
import type { FilterPlan } from "../lib/graphFilter";
import { toast } from "./toasts";
import { useApp } from "./useApp";

export type { ScrollAxisName };
type S = ReturnType<typeof useApp.getState>;
/** The view limits one scroll run can change; `y2Lim` only when the plot has a Y2 axis, `yN` (by axis number) only
 *  when it has Y3+ axes. */
type Lims = { xLim: S["xLim"]; yLim: S["yLim"]; y2Lim?: S["y2Lim"]; yN?: Record<number, [number, number] | null> };
let dragFrom: Lims | null = null;

const limsOf = (s: S): Lims => ({
  xLim: s.xLim, yLim: s.yLim,
  ...(s.y2Keys?.length ? { y2Lim: s.y2Lim } : {}),
  ...(s.yAxes.length ? { yN: Object.fromEntries(s.yAxes.map((a, i) => [i + 3, a.lim])) } : {}),
});

/** Move the zoomed window of `axis` to slider position `t` within `extent`, live (no history yet). */
export function scrollAxisTo(axis: ScrollAxisName, extent: Extent, t: number): void {
  const s = useApp.getState();
  const lim = fixedLim(scrollLim(s, axis));
  if (!lim) return;
  dragFrom ??= limsOf(s);
  const win = scrolledWindow(lim, extent, t, scrollKind(s, axis)); // each axis scrolls in its own space
  const n = axisNumberOf(axis);
  useApp.setState(
    axis === "x" ? { xLim: win }
      : axis === "y" ? { yLim: win }
        : axis === "y2" ? { y2Lim: win }
          : { yAxes: s.yAxes.map((a, i) => (i + 3 === n ? { ...a, lim: win } : a)) },
  );
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
