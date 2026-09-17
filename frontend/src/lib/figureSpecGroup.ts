// BUG-013 round 4: the `group_col` a figure request actually emits, resolved
// in ONE place so `figureSpec.ts`'s wire field and its waterfall refusal read
// the SAME answer to "is this request really grouped?".
//
// Split out of `figureSpec.ts` to fund this fix against that file's 500-line
// ceiling — a fresh, cohesive module rather than a ceiling raise, the same
// call `lib/figureSpecSeries.ts`, `lib/figureViewOverrides.ts` and
// `lib/plotGroupSplit.ts` made before it (see each module's own header).
//
// ROUND 5 CORRECTION: round 4 kept a THROW here for a group bound with a
// REALLY rendered secondary axis (the "hidden" case degraded; the "plotted"
// case refused), reasoning that a plotted y2 makes the conflict "genuine,
// not a degrade case". That reasoning didn't survive contact with the
// canvas: `Stage/usePlotPayload` asks `canvasGroupCol` on the view's RAW
// `y2Keys`, with no plotted/hidden distinction at all, so the screen already
// degrades a grouped view with a PLOTTED secondary axis to a plain, staggered
// overlay — reachable with one click (bind Group, then right-click a series
// -> Y2). The throw only ever fired on the wire, so "Export figure…"/"Copy
// figure" refused outright for a figure the user was already looking at.
// Deleted: there is now exactly one predicate (`canvasGroupCol`) and exactly
// one answer, screen and export alike.
import { canvasGroupCol } from "./plotGroupSplit";

/** Resolve the `group_col` a figure request actually emits — the SAME
 *  `canvasGroupCol` predicate `Stage/usePlotPayload` asks to decide what the
 *  canvas draws, so a group bound with its secondary axis non-empty (hidden
 *  OR plotted) degrades to a plain overlay on the wire exactly as it does on
 *  screen, instead of putting `group_col` on a request the renderer would
 *  draw ungrouped. Before this existed, that combination could export a
 *  grouped, un-staggered figure for an ungrouped, staggered screen. */
export function resolveGroupCol(
  groupKey: number | null | undefined,
  y2Keys: readonly number[] | null | undefined,
): number | null {
  return canvasGroupCol(groupKey, y2Keys);
}
