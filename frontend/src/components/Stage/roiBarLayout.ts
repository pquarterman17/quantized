// Shared, pure (no React/DOM) layout helpers for the ROI inline commit bars —
// extracted out of MapRoiOverlay.tsx (RSM_CUTS_PLAN item 12) so the sector
// wedge's own bar (MapSectorWedge.tsx) can reuse the EXACT same sparkline
// renderer and bar-positioning math the box/ruler bars already use, instead
// of a third copy. Kept free of JSX so it stays trivially unit-testable, the
// same purity split as `lib/roi.ts`/`lib/roiMath.ts`.

import type { RoiProfile } from "../../lib/roiMath";

export const SPARK_W = 176;
export const SPARK_H = 30;
// Matches `.qzk-roi-bar`'s fixed CSS width (shell.css) and an estimate of its
// no-stats-shown height — the clamp in `barPosition` only needs to be close
// (a taller readout, when it appears, is allowed to run slightly past this
// estimate; it still stays inside the plot rect on the axis that matters,
// horizontal).
export const BAR_W = 216;
export const BAR_H = 140;

/** SVG polyline `points` for a preview profile's intensity, normalized into
 *  a `w`x`h` box (min at the bottom, max at the top; a non-finite value
 *  degrades to the bottom edge rather than breaking the polyline). Empty
 *  string for fewer than 2 points or an all-non-finite profile — nothing
 *  sane to draw. */
export function sparklinePoints(profile: RoiProfile, w: number, h: number): string {
  const n = profile.intensity.length;
  if (n < 2) return "";
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = profile.intensity[i]!;
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "";
  const span = hi - lo || 1;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = profile.intensity[i]!;
    const x = (i / (n - 1)) * w;
    const y = Number.isFinite(v) ? h - ((v - lo) / span) * h : h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Bounding box (px) of an arbitrary point set — the shape-agnostic input
 *  `barPosition` needs (a rect's 2 corners, a ruler's 4 corners, or a
 *  sector's 4 handle positions all reduce to this). */
export function boundsOfPoints(pts: readonly { x: number; y: number }[]): { x0: number; y0: number; x1: number; y1: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Keep the inline bar clear of the shape it belongs to (below it, or above
 *  when that would run off the bottom) and inside the plot rect on both
 *  axes. */
export function barPosition(
  rectPx: { x0: number; y0: number; x1: number; y1: number },
  plot: { x: number; y: number; w: number; h: number },
): { left: number; top: number } {
  let top = rectPx.y1 + 8;
  if (top + BAR_H > plot.y + plot.h) top = rectPx.y0 - BAR_H - 8;
  const left = Math.min(Math.max(rectPx.x0, plot.x), plot.x + Math.max(0, plot.w - BAR_W));
  return { left, top: Math.min(Math.max(top, plot.y), plot.y + Math.max(0, plot.h - BAR_H)) };
}
