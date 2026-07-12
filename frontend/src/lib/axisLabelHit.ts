// Pure geometry for the draggable axis titles (Origin-parity: click+drag an
// axis title clear of long tick labels). The rich-label plugin measures each
// title's rendered width and calls `axisLabelRect` to get its CSS-px bounding
// box; `hitAxisLabel` point-tests those boxes. Kept pure (no uPlot/DOM) so the
// grab math is unit-tested without a canvas — the interaction wiring in
// uplotRichLabels.ts stays thin.

import type { AxisKey } from "./types";

export interface LabelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A little slop around the ink so a title is easy to grab. */
const GRAB_PAD = 4;

/** The CSS-px bounding box of an axis title, given its rendered CENTER (already
 *  offset), its advance `width`, its font size `px`, and its orientation. A
 *  vertical (rotated left/right) title's advance runs down the page, so width
 *  and thickness swap. Padded so the title is easy to grab. */
export function axisLabelRect(
  cx: number,
  cy: number,
  width: number,
  px: number,
  vertical: boolean,
): LabelRect {
  const halfW = (vertical ? px : width) / 2 + GRAB_PAD;
  const halfH = (vertical ? width : px) / 2 + GRAB_PAD;
  return { left: cx - halfW, top: cy - halfH, width: halfW * 2, height: halfH * 2 };
}

/** Which axis title (if any) the point (x, y) — CSS px relative to the plot
 *  root — falls on. Checks y2 before y before x so a point in an overlapping
 *  gutter resolves to the nearest side title first. */
export function hitAxisLabel(
  rects: Partial<Record<AxisKey, LabelRect>>,
  x: number,
  y: number,
): AxisKey | null {
  for (const axis of ["y2", "y", "x"] as const) {
    const r = rects[axis];
    if (r && x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) {
      return axis;
    }
  }
  return null;
}
