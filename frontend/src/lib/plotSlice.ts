// Data slicer (Origin's Data Slicer on a graph; gap plan item 22): drag a
// rectangle with the Select rows tool, then act on what is inside. The drag
// already selects the rows (lib/plotPointMask.pickRows, through the row-state
// model); this module adds what the menu needs on top of it: the rectangle
// itself, read back from the box the tool leaves painted, and the plan that
// turns it into an ordinary, editable Data Filter ("plotted data limited to this
// X and Y window"). Keep only / Exclude / Extract act on the selected rows and
// reuse the worksheet's own actions (store/rowState, extractRows).
//
// The filter is the shortest honest path onto the EXISTING Data Filter
// (lib/graphFilter.planViewFilter with the box as the window); nothing here
// writes row state. Fail closed: a display that does not show source values
// (X waterfall blocks, a category axis) refuses; a staggered Y (waterfall) or a
// box with several curves filters on X only and says so.

import type uPlot from "uplot";

import { visibleCurves } from "./browseGraph";
import { planViewFilter, type FilterPlan } from "./graphFilter";
import type { RebindState } from "./curveRebind";
import type { PlotPayload } from "./plotdata";
import { selectSpan } from "./uplotPointer";

/** The rectangle a Select rows drag painted, in data values on each Y axis the plot has. */
export interface SliceBox {
  x: [number, number];
  /** Absent for an X band (a drag with no real height). */
  y?: [number, number];
  y2?: [number, number];
}

/** The painted selection box of `u`, or null when there is none. A box as tall as the plot is an X band. */
export function sliceBoxOf(u: uPlot, hasY2: boolean): SliceBox | null {
  const [off, len, cOff, cLen, full] = selectSpan(u);
  if (!(len > 0)) return null;
  const x: [number, number] = [u.posToVal(off, "x"), u.posToVal(off + len, "x")];
  if (!x.every(Number.isFinite)) return null;
  if (!(cLen > 0) || (full > 0 && cLen >= full - 1)) return { x };
  const edges = (scale: string): [number, number] => [u.posToVal(cOff, scale), u.posToVal(cOff + cLen, scale)];
  return { x, y: edges("y"), ...(hasY2 ? { y2: edges("y2") } : {}) };
}

export type SlicePlan = { plan: FilterPlan; skippedY: string | null };

/** The Data Filter edits that keep the rows inside `box`: its X window and, when the plot shows exactly one
 *  curve on a scale the box has edges for and the Y is not staggered, its Y window. */
export function planSliceFilter(s: RebindState & { y2Keys: readonly number[] | null }, box: SliceBox, payload: Pick<PlotPayload, "yShift" | "blockRows" | "xCategories">): SlicePlan {
  const none = (why: string): SlicePlan => ({ plan: { ok: false, why }, skippedY: null });
  if (payload.xCategories) return none("A category axis has no X window to filter on.");
  if (payload.blockRows) return none("This plot staggers X (waterfall): its X values are not the data's, so a window on them cannot filter the rows.");
  const channels = visibleCurves(s);
  const edge = channels.length === 1 ? (s.y2Keys?.includes(channels[0]) ? box.y2 : box.y) : undefined;
  const staggered = (payload.yShift ?? []).some((v) => v !== 0);
  const skippedY = !box.y
    ? null
    : channels.length !== 1
      ? "the Y window needs exactly one visible curve"
      : staggered
        ? "the plot is staggered (waterfall), so its Y is not the data's"
        : edge
          ? null
          : "the box has no edge on that curve's Y axis";
  const withY = !!edge && !staggered;
  return { plan: planViewFilter({ ...s, xLim: box.x, yLim: withY ? edge! : null }, withY), skippedY };
}

/** The selected rows still in the analysis: not masked, not filtered out (what the worksheet's Extract takes). */
export function liveSelectedRows(rows: readonly number[], excluded: ReadonlySet<number>, filteredOut: ReadonlySet<number>): number[] {
  return [...new Set(rows)].filter((r) => !excluded.has(r) && !filteredOut.has(r)).sort((a, b) => a - b);
}
