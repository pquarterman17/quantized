// Shared 2-D point-marker gesture core (MAIN_PLAN #8 consolidation): the
// pixel-frame conversion + nearest-point hit test that uplotAnchors (baseline
// anchor editing) and peakMarkerHit (peak-wizard marker editing) each carried
// as near-clones. The 2026-07-11 review's canvas-vs-CSS pixel-frame bug had to
// be fixed TWICE because this core existed twice — one implementation means
// one frame convention and one place to fix. The 1-D siblings (uplotGadgets'
// hitTestRoiHandles/hitTestCursorHandles bands, uplotOverlays' pickRefLine)
// stay separate: their geometry is an edge/band, not a point.

import type uPlot from "uplot";

/** Click-vs-drag pointer-travel threshold (px), shared by the point-gesture
 *  plugins (same convention as the gadget plugins): movement under this is a
 *  click; at/over it is a drag (box zoom / pan / marker drag). */
export const CLICK_PX = 6;

/** One editable point in DATA coords, tagged with its index into the OWNER'S
 *  full list (what onAdd/onMove/onRemove-style callbacks expect back — NOT its
 *  position among only the currently-visible points). */
export interface GesturePoint {
  index: number;
  x: number;
  y: number;
}

/** Point data coords → plot pixels via `valToPos` — a thin, separately
 *  testable step (the gadget plugins' `fakeU` idiom: a minimal `{valToPos}`
 *  stub stands in for uPlot).
 *
 *  CSS px relative to `u.over` — the SAME frame as the pointer coords the hit
 *  tests use (clientX - rect.left). The `true` canvas-pixel form is DPR-scaled
 *  + bbox-offset and belongs only in ctx draw code (review 2026-07-11: with
 *  `true` here, click-on-marker missed by the axis gutter and every
 *  remove/drag gesture was unreachable — in BOTH former copies of this
 *  function). */
export function pointPixels(
  u: Pick<uPlot, "valToPos">,
  points: readonly GesturePoint[],
): (GesturePoint & { px: number; py: number })[] {
  return points.map((p) => ({
    ...p,
    px: u.valToPos(p.x, "x"),
    py: u.valToPos(p.y, "y"),
  }));
}

/** Which point (in PIXELS, from `pointPixels`) the pointer is nearest to,
 *  within `tol` px — Euclidean, since a marker is a POINT (the tolerance is a
 *  circle around it, not a 1-D band). Nearest wins; an exact-distance tie
 *  keeps the earlier (lower-index) point. Null when nothing is within
 *  tolerance, including an empty list. */
export function hitTestPoints(
  points: readonly { index: number; px: number; py: number }[],
  pointer: { x: number; y: number },
  tol = 8,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) continue;
    const d = Math.hypot(p.px - pointer.x, p.py - pointer.y);
    if (d <= tol && d < bestDist) {
      bestDist = d;
      best = p.index;
    }
  }
  return best;
}
