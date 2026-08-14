// Edge / sibling snapping while dragging a plot window (MULTI_PLOT_PLAN item
// 12). Extracted out of plotview.ts (F2.3j, funding the region-shades
// sanitizer's headroom under that module's store-size-style pin) — this pure
// geometry has nothing to do with the PlotView data model itself, unlike
// everything else that file owns; `PlotWindowFrame.tsx` was already its only
// non-test consumer, so the move touches nothing else.

import type { WindowGeometry } from "./plotview";

/** How close (px) a window edge must be to a snap line before it snaps. */
export const SNAP_THRESHOLD = 8;

/** All the vertical (`v`) and horizontal (`h`) snap lines a dragged window
 *  can land on: the canvas edges plus BOTH edges of every sibling rect on
 *  each axis — one flat pool per axis, so edge-ALIGN (our left on a
 *  sibling's left) and ABUT (our left on a sibling's right) fall out of the
 *  same comparison instead of being separate cases. */
function collectSnapLines(
  bounds: { width: number; height: number } | undefined,
  siblings: readonly WindowGeometry[],
): { v: number[]; h: number[] } {
  const v: number[] = bounds ? [0, bounds.width] : [];
  const h: number[] = bounds ? [0, bounds.height] : [];
  for (const s of siblings) {
    v.push(s.x, s.x + s.w);
    h.push(s.y, s.y + s.h);
  }
  return { v, h };
}

/** The adjustment that moves the best of `edges` onto the nearest of `lines`,
 *  or 0 when nothing is within `threshold` — the NEAREST candidate wins
 *  across all edge×line pairs on this axis. */
function snapDelta(edges: readonly number[], lines: readonly number[], threshold: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (const edge of edges) {
    for (const line of lines) {
      const d = line - edge;
      const dist = Math.abs(d);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
  }
  return best;
}

/** Snap a MOVE gesture's proposed geometry: either vertical edge (left OR
 *  right) may pull `x`, either horizontal edge (top OR bottom) may pull `y`
 *  — the two axes snap independently. Returns the snapped position only (a
 *  move never changes size). Pure; `PlotWindowFrame` applies this before its
 *  clamp + rAF-throttled store write, and skips it while Alt is held (the
 *  standard window-manager convention). */
export function snapMovePosition(
  proposed: WindowGeometry,
  bounds: { width: number; height: number } | undefined,
  siblings: readonly WindowGeometry[],
  threshold: number = SNAP_THRESHOLD,
): { x: number; y: number } {
  const lines = collectSnapLines(bounds, siblings);
  return {
    x: proposed.x + snapDelta([proposed.x, proposed.x + proposed.w], lines.v, threshold),
    y: proposed.y + snapDelta([proposed.y, proposed.y + proposed.h], lines.h, threshold),
  };
}

/** Snap a RESIZE gesture's proposed geometry: only the MOVING edges — the
 *  right (`x+w`) and bottom (`y+h`), matching the frame's single bottom-right
 *  grip — may pull `w`/`h`; the anchored left/top edges never snap. Returns
 *  the snapped size only (a resize never changes position). */
export function snapResizeSize(
  proposed: WindowGeometry,
  bounds: { width: number; height: number } | undefined,
  siblings: readonly WindowGeometry[],
  threshold: number = SNAP_THRESHOLD,
): { w: number; h: number } {
  const lines = collectSnapLines(bounds, siblings);
  return {
    w: proposed.w + snapDelta([proposed.x + proposed.w], lines.v, threshold),
    h: proposed.h + snapDelta([proposed.y + proposed.h], lines.h, threshold),
  };
}
