// BUG-013 round 4: the `group_col` a figure request actually emits, resolved
// in ONE place so `figureSpec.ts`'s wire field and its waterfall refusal can
// never read two different answers to "is this request really grouped?".
//
// Split out of `figureSpec.ts` to fund this fix against that file's 500-line
// ceiling — a fresh, cohesive module rather than a ceiling raise, the same
// call `lib/figureSpecSeries.ts`, `lib/figureViewOverrides.ts` and
// `lib/plotGroupSplit.ts` made before it (see each module's own header).

import { canvasGroupCol } from "./plotGroupSplit";

/** Resolve the `group_col` a figure request actually emits, and refuse the
 *  one combination the renderer cannot draw at all.
 *
 *  The renderer deliberately has no grouped-secondary-axis semantic: group
 *  expansion produces synthetic primary-axis series, so the backend rejects
 *  it. Fail before transport rather than silently drop a canonical binding or
 *  send a request guaranteed a 422 — asked on the RAW `groupKey` binding,
 *  because an ACTUALLY rendered secondary axis (`y2Plotted`, i.e. a y2-tagged
 *  channel that is really plotted, not merely bound-and-hidden) is a genuine
 *  conflict with an explicit group binding, not a degrade case.
 *
 *  Everywhere else, the emitted value degrades exactly like the canvas — the
 *  SAME `canvasGroupCol` predicate `Stage/usePlotPayload` asks — so a group
 *  bound with its y2 channel merely HIDDEN (`y2Plotted` false, the throw
 *  above never fires) does not put `group_col` on the wire while the canvas
 *  has already degraded to a plain, staggered overlay. Before this function
 *  existed, that combination exported a grouped, un-staggered figure for an
 *  ungrouped, staggered screen — reachable with one legend click. */
export function resolveGroupCol(
  groupKey: number | null | undefined,
  y2Plotted: boolean,
  y2Keys: readonly number[] | null | undefined,
): number | null {
  if (groupKey !== null && groupKey !== undefined && y2Plotted) {
    throw new Error("grouped figures cannot use a secondary Y axis");
  }
  return canvasGroupCol(groupKey, y2Keys);
}
