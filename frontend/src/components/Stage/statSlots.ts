// P2.6: put the EMPTY level slots back into a computed box/violin/strip draw.
//
// The per-group stats (`/api/statplots/box`, `/violin`, or the client box-stats
// fallback) are computed over the NON-EMPTY groups only — an empty sample has
// no quartiles, KDE or mean, and the backend rightly refuses one. The slot
// list (`lib/levelSlots.buildLevelSlots`) is what the axis must show, so after
// the stats come back each empty slot is spliced in at its own position as an
// `n = 0` placeholder the renderers draw as label-only (`statRenderBox.ts`
// returns early on `n === 0`; `drawViolins` on a one-point outline). The count
// labels ride along on the draw so the canvas and the export (which sends the
// SAME `countLabels` as `count_labels`) print identical text per slot.

import type { GroupSpec } from "../../lib/statschooser";
import type { BoxStat } from "../../lib/statstage";
import type { BoxPointsGroup, StatDrawData, ViolinGroup } from "./statRender";

const emptyBox = (label: string): BoxStat => ({
  label, q1: NaN, median: NaN, q3: NaN, iqr: NaN, whislo: NaN, whishi: NaN,
  mean: NaN, sem: NaN, ciLo: NaN, ciHi: NaN, n: 0, fliers: [],
});
// `x: [NaN]` rather than `[]`: the violin domain reads `x[0] ?? 0`, and an
// empty array would drag 0 into every plot's value range.
const emptyViolin = (label: string): ViolinGroup => ({
  label, x: [NaN], density: [0], quartiles: [NaN, NaN, NaN], n: 0,
});
const emptyPoints = (label: string): BoxPointsGroup => ({ label, points: [] });

/** `filled` (one entry per NON-empty slot, in order) expanded to one entry per
 *  slot, with `make(label)` at each empty one. */
export function spliceSlots<T>(
  filled: readonly T[],
  slots: readonly GroupSpec[],
  make: (label: string) => T,
): T[] {
  let k = 0;
  return slots.map((s) => (s.values.length > 0 ? filled[k++] : make(s.label)));
}

/** Is `draw` the stats OF these filled slots — same count, and the same label
 *  and n in the same order? Comparing counts alone (PR #433 review) let a
 *  value/nesting/filter change that kept the filled COUNT splice the previous
 *  pick's boxes one slot off until the refetch landed. Every box/violin entry
 *  carries its group's label (backend echoes the request's `labels`; the
 *  client fallback and violin builder copy `GroupSpec.label`) and its n. */
function sameFilled(
  draw: Extract<StatDrawData, { mode: "box" | "violin" | "strip" }>,
  slots: readonly GroupSpec[],
): boolean {
  const filled = slots.filter((s) => s.values.length > 0);
  const drawn: readonly { label: string; n: number }[] = draw.mode === "violin" ? draw.violins : draw.boxes;
  return (
    drawn.length === filled.length &&
    drawn.every((d, i) => d.label === filled[i].label && d.n === filled[i].values.length)
  );
}

/** `draw` with every empty slot of `slots` restored and `countLabels`
 *  attached (bar: attached only — its matrix already carries empty cells).
 *  Q-Q/histogram pass through untouched. A draw whose filled entries do not
 *  line up with the slots (a stale draw from the previous picks, still on
 *  screen while the new stats load) is returned as-is rather than spliced
 *  against the wrong slots. */
export function withEmptySlots(
  draw: StatDrawData | null,
  slots: readonly GroupSpec[],
  countLabels: (string | null)[],
): StatDrawData | null {
  if (!draw || draw.mode === "qq" || draw.mode === "histogram") return draw;
  if (draw.mode === "bar") return { ...draw, countLabels };
  if (!sameFilled(draw, slots)) return draw;
  if (draw.mode === "box") {
    const points = draw.points ? spliceSlots(draw.points, slots, emptyPoints) : draw.points;
    return { ...draw, boxes: spliceSlots(draw.boxes, slots, emptyBox), points, countLabels };
  }
  if (draw.mode === "violin") {
    return { ...draw, violins: spliceSlots(draw.violins, slots, emptyViolin), countLabels };
  }
  return {
    ...draw,
    boxes: spliceSlots(draw.boxes, slots, emptyBox),
    points: spliceSlots(draw.points, slots, emptyPoints),
    countLabels,
  };
}
