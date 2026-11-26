// Canvas drawing of point labels with "Avoid overlaps" on (plan item 18): the
// shared placement rule (lib/labelPlacement.ts, twin of calc/label_placement.py)
// over this canvas's own text metrics, then the boxes and any leader lines.
// A label with no free slot stays at the default slot and is counted, never dropped.

import type uPlot from "uplot";

import { placeLabels, type PlaceItem } from "./labelPlacement";
import type { LabelAvoid } from "./pointLabelAvoid";

export interface AvoidAnchor { text: string; x: number; y: number; importance: number; color: string; markerR: number }

/** The note appended to the layout message when some labels found no free slot. */
export function overlapNote(n: number): string | null {
  return n > 0 ? `${n} ${n === 1 ? "label" : "labels"} could not avoid overlap` : null;
}

/** Place and draw `anchors` (device px) inside the plot box; returns how many overlap. */
export function drawAvoiding(u: uPlot, anchors: readonly AvoidAnchor[], avoid: LabelAvoid, px: number): number {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const h = 11 * px * 1.2;
  const items: PlaceItem[] = anchors.map((a) => ({ ax: a.x, ay: a.y, w: ctx.measureText(a.text).width, h, importance: a.importance }));
  const placed = placeLabels(items, { left, top, right: left + width, bottom: top + height }, {
    gap: 4 * px,
    markerR: Math.max(2 * px, ...anchors.map((a) => a.markerR)),
    step: h,
    rings: 3,
    pad: px,
    leaderMin: avoid.leaderDistance,
  });
  ctx.textBaseline = "top";
  let overlapping = 0;
  placed.forEach((p, i) => {
    const a = anchors[i];
    if (p.overlap) overlapping++;
    if (p.leader) {
      ctx.save();
      ctx.strokeStyle = a.color;
      ctx.lineWidth = avoid.leaderWidth * px;
      ctx.setLineDash(avoid.leaderDashed ? [4 * px, 3 * px] : []);
      ctx.beginPath();
      ctx.moveTo(p.leader[0], p.leader[1]);
      ctx.lineTo(p.leader[2], p.leader[3]);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = a.color;
    ctx.fillText(a.text, p.left, p.top);
  });
  ctx.textBaseline = "alphabetic";
  return overlapping;
}
