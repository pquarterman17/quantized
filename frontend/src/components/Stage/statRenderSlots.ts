// Category-slot layout for the Canvas2D statistical stage when the axis
// carries EMPTY slots (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 2, "missing levels
// are explicit"). A draw's glyph arrays (boxes / violins / points) hold only
// the groups that HAVE data; `AxisSlot[]` (`lib/groupAxis`) says where each of
// them sits on the axis and which slots are empty. This module turns that into
// pixel slots, and paints the two marks the export draws too
// (`calc.figure_group_notes`): the muted `n=0` marker in an empty slot, and
// the optional `n=K` caption above every slot.
//
// Without `slots` (a draw from a path that predates this, or a failed
// alignment) the plan is the identity — one slot per group, exactly the layout
// every box-family renderer used before.

import type { AxisSlot } from "../../lib/groupAxis";
import { categorySlots, type CategorySlot } from "../../lib/statstage";
import type { Rect } from "./statRender";

export interface SlotPlan {
  /** Tick label per AXIS slot. */
  labels: string[];
  /** Pixel-fraction slot per AXIS slot. */
  slots: CategorySlot[];
  /** Axis-slot index of each plotted group, in group order. */
  groupSlot: number[];
  /** Axis-slot indices that hold no group. */
  empty: number[];
  /** Per plotted group: must the connect-means line LIFT before it? True
   *  where a visible empty slot sits between it and the previous group, or
   *  where hidden empties did (`AxisSlot.gapBefore`, `groupAxis.visibleSlots`).
   *  Export twin: `calc.figure_group_notes.connect_segments`' breaks. */
  gaps: boolean[];
}

function identity(groupLabels: readonly string[]): SlotPlan {
  return {
    labels: [...groupLabels],
    slots: categorySlots(groupLabels.length),
    groupSlot: groupLabels.map((_, i) => i),
    empty: [],
    gaps: groupLabels.map(() => false),
  };
}

/** The layout for `groupLabels.length` plotted groups on `axis`. Falls back to
 *  the identity when `axis` is absent or does not place every group exactly
 *  once — never a half-mapped axis. */
export function slotPlan(axis: readonly AxisSlot[] | null | undefined, groupLabels: readonly string[]): SlotPlan {
  if (!axis) return identity(groupLabels);
  const groupSlot: number[] = new Array<number>(groupLabels.length).fill(-1);
  const empty: number[] = [];
  let placed = 0;
  axis.forEach((s, i) => {
    if (s.group === null) empty.push(i);
    else if (s.group >= 0 && s.group < groupLabels.length && groupSlot[s.group] === -1) {
      groupSlot[s.group] = i;
      placed++;
    }
  });
  if (placed !== groupLabels.length || placed + empty.length !== axis.length) return identity(groupLabels);
  // A line drawn across a missing level asserts a trend through data that does
  // not exist, so it lifts at a visible empty slot AND at a hidden one.
  const gaps = groupSlot.map((s, i) => i > 0 && (s !== groupSlot[i - 1] + 1 || axis[s].gapBefore === true));
  return { labels: axis.map((s) => s.label), slots: categorySlots(axis.length), groupSlot, empty, gaps };
}

/** The muted, italic `n=0` marker in every `empty` slot, mid-panel. */
export function drawEmptySlotMarkers(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  slots: readonly CategorySlot[],
  empty: readonly number[],
  muted: string,
) {
  if (!empty.length) return;
  ctx.fillStyle = muted;
  ctx.font = "italic 10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const i of empty) ctx.fillText("n=0", rect.x + slots[i].cx * rect.w, rect.y + rect.h / 2);
}

/** "n=<count>" caption above one slot (shared by box / violin / strip / bar). */
export function drawCountLabel(ctx: CanvasRenderingContext2D, cx: number, top: number, n: number, muted: string) {
  ctx.fillStyle = muted;
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`n=${n}`, cx, top - 4);
}

/** The optional per-group n annotation: `n=K` above every AXIS slot (empty
 *  ones read `n=0`), where the export puts its top-axis counts. `groupN[g]`
 *  is plotted group g's own sample size. */
export function drawSlotCounts(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  plan: SlotPlan,
  groupN: readonly number[],
  muted: string,
) {
  const nAt = new Array<number>(plan.slots.length).fill(0);
  plan.groupSlot.forEach((slot, g) => {
    nAt[slot] = groupN[g] ?? 0;
  });
  plan.slots.forEach((s, i) => drawCountLabel(ctx, rect.x + s.cx * rect.w, rect.y, nAt[i], muted));
}
