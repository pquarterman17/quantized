// Canvas drawing of point labels with "Avoid overlaps" on (plan item 18): the
// shared placement rule (lib/labelPlacement.ts, twin of calc/label_placement.py)
// over this canvas's own text metrics, then the boxes and any leader lines.
// A label with no free slot stays at the default slot and is counted, never dropped.

import type uPlot from "uplot";

import { placeLabels, type PlaceItem, type PlaceRect } from "./labelPlacement";
import type { LabelAvoid } from "./pointLabelAvoid";

export interface AvoidAnchor { text: string; x: number; y: number; importance: number; color: string; markerR: number }

/** The note appended to the layout message when some labels found no free slot. */
export function overlapNote(n: number): string | null {
  return n > 0 ? `${n} ${n === 1 ? "label" : "labels"} could not avoid overlap` : null;
}

/** The on-screen legend box in this canvas's device pixels, or none (no legend, or not laid out). */
function legendBlock(u: uPlot, px: number): PlaceRect[] {
  const legend = u.root?.closest?.(".qzk-stage")?.querySelector(":scope > .qzk-legend");
  const over = u.over?.getBoundingClientRect?.();
  const r = legend?.getBoundingClientRect();
  if (!r || !over || r.width === 0 || r.height === 0) return [];
  const left = u.bbox.left + (r.left - over.left) * px, top = u.bbox.top + (r.top - over.top) * px;
  return [{ left, top, right: left + r.width * px, bottom: top + r.height * px }];
}

/** Place and draw `anchors` (device px) inside the plot box, keeping the bottom `reserveBottom` px
 *  (the note line) clear; returns how many overlap. */
export function drawAvoiding(u: uPlot, anchors: readonly AvoidAnchor[], avoid: LabelAvoid, px: number, reserveBottom = 0): number {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const h = 11 * px * 1.2;
  const items: PlaceItem[] = anchors.map((a) => ({ ax: a.x, ay: a.y, w: ctx.measureText(a.text).width, h, importance: a.importance }));
  const placed = placeLabels(items, { left, top, right: left + width, bottom: top + height - reserveBottom }, {
    gap: 4 * px,
    markerR: Math.max(2 * px, ...anchors.map((a) => a.markerR)),
    step: h,
    rings: 3,
    pad: px,
    leaderMin: avoid.leaderDistance,
    blocked: legendBlock(u, px),
  });
  ctx.textBaseline = "top";
  ctx.textAlign = "left"; // the placed box's left edge is where the text starts
  let overlapping = 0;
  placed.forEach((p, i) => {
    const a = anchors[i];
    if (p.overlap) overlapping++;
    if (p.leader) {
      ctx.save();
      // A theme ink, not the curve's colour: the curve's own line crosses the cluster in that colour
      // and hides the leader; the width never drops under one CSS pixel so it stays visible.
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-dim").trim() || a.color;
      ctx.lineWidth = Math.max(avoid.leaderWidth, 1) * px;
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
