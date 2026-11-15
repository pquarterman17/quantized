// The axis double-click hit test (figures-audit #6), split out of
// AxisDropZones.tsx as a lazy piece for the eager-bundle budget: it only runs
// after a double-click, which then opens the (also lazy) Axis dialog.

import { openRightAxis } from "../../lib/multiYCommands";
import { openFigureDialog, type AxisId } from "../../store/figureDialogs";
import { useApp } from "../../store/useApp";

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

/** Every drawn right-hand axis' left edge, sorted (read here, not in
 *  AxisDropZones.tsx, for the eager bundle; the axes do not move while this
 *  chunk loads). */
export function rightAxisLefts(root: Element, overRight: number): number[] {
  const boxes = [...root.querySelectorAll(".u-axis")].map((el) => el.getBoundingClientRect());
  return boxes.filter((b) => b.width > 0 && b.left >= overRight - 1).map((b) => b.left).sort((a, b) => a - b);
}

/** The double-click itself: the X / Y / Y2 Axis dialog, or -- when the graph
 *  has Y3+ axes (gap audit 4 G11) -- the right-hand axis under the pointer,
 *  found from the drawn axes' left edges (`axes`: the chart element, or those
 *  edges already read, sorted). */
export function openAxisAt(over: Box, root: Box, x: number, y: number, hasY2: boolean, axes: Element | readonly number[]): void {
  const rights = "querySelectorAll" in axes ? rightAxisLefts(axes, over.right) : axes;
  const inY = y >= over.top && y <= over.bottom;
  const rank = Math.max(0, rights.filter((left) => left <= x).length - 1);
  if (inY && x > over.right && x <= root.right && rights.length > 0 && openRightAxis(useApp.getState, rank)) return;
  const axis = axisAtPoint(over, root, x, y, hasY2);
  if (axis) openFigureDialog({ kind: "axis", axis });
}
