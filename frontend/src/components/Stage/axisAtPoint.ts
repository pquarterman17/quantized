// The axis double-click hit test (figures-audit #6), split out of
// AxisDropZones.tsx as a lazy piece for the eager-bundle budget: it only runs
// after a double-click, which then opens the (also lazy) Axis dialog.

import type { AxisId } from "../../store/figureDialogs";

type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

/** Figures-audit #6: which axis a double-click at (x, y) landed on -- the
 *  band between the plot area (uPlot's `.u-over`) and the chart's outer
 *  box: below it = X, left = Y, right = Y2 (only when one is drawn). Null
 *  inside the plot area or in a corner. */
export function axisAtPoint(over: Box, root: Box, x: number, y: number, hasY2: boolean): AxisId | null {
  if (x < root.left || x > root.right || y < root.top || y > root.bottom) return null;
  const inX = x >= over.left && x <= over.right;
  const inY = y >= over.top && y <= over.bottom;
  if (inX && y > over.bottom) return "x";
  if (inY && x < over.left) return "y";
  if (inY && x > over.right && hasY2) return "y2";
  return null;
}
