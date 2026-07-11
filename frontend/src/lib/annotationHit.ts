// Pure hit-test geometry for pointer-mode annotation direct manipulation
// (MAIN #18). An annotation is a dot + a label, not a bare point, so this
// doesn't reuse pointGesture.ts's point-only hitTestPoints (uplotAnchors'/
// peakMarkerHit's marker gestures) — a hit needs BOTH a point test (the dot)
// and a rect test (the label's measured text extents). Kept separate from
// uplotOverlays.ts (which owns the canvas draw + drag wiring) so the geometry
// math is unit-testable without a canvas stub — the same draw/hit-test split
// pointGesture.ts uses, and for the same reason its header warns about: one
// implementation, so draw and hit-test can never silently drift apart.

/** CSS pointer coords (relative to `u.over`, i.e. `clientX - rect.left`) →
 *  the CANVAS-pixel frame `annotationLayout` lives in (DPR-scaled +
 *  bbox-offset, because the draw pass owns that geometry). Hit tests must
 *  compare pointer and geometry in ONE frame — the 2026-07-11 owner-reported
 *  bug ("can't drag the 700 mT label; it box-zooms instead") was exactly this
 *  mismatch: at Windows 125–150% display scaling the CSS pointer never landed
 *  inside the canvas-px label box. Same bug class the same-day review fixed in
 *  uplotAnchors (there the fix was the opposite direction: draw code keeps the
 *  `true` form, pointer code the CSS form — either way, ONE frame per
 *  comparison). Returns the scale so callers can convert CSS-px tolerances
 *  too. Degenerate rects (jsdom, not laid out) fall back to scale 1. */
export function overPointerToCanvas(
  bbox: { left: number; top: number; width: number; height: number },
  rect: { width: number; height: number },
  cssX: number,
  cssY: number,
): { x: number; y: number; scale: number } {
  const scale = rect.width > 0 && bbox.width > 0 ? bbox.width / rect.width : 1;
  const sy = rect.height > 0 && bbox.height > 0 ? bbox.height / rect.height : scale;
  return { x: bbox.left + cssX * scale, y: bbox.top + cssY * sy, scale };
}

/** One annotation's hit-test geometry, canvas pixels — the dot center plus
 *  the label's bounding box (both derived from `uplotOverlays.annotationLayout`,
 *  the SAME geometry the draw pass uses). */
export interface AnnotationHitGeometry {
  id: string;
  px: number;
  py: number;
  box: { left: number; top: number; width: number; height: number };
}

/** Nearest annotation under the pointer: the dot (point tolerance) wins over
 *  the label rect when both are in range — the dot is the smaller, more
 *  precise target; a rect hit only fires when no dot is within tolerance.
 *  Null when nothing is hit (including an empty list). */
export function hitTestAnnotationBody(
  geoms: readonly AnnotationHitGeometry[],
  pointer: { x: number; y: number },
  dotTol = 8,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const g of geoms) {
    if (!Number.isFinite(g.px) || !Number.isFinite(g.py)) continue;
    const d = Math.hypot(g.px - pointer.x, g.py - pointer.y);
    if (d <= dotTol && d < bestDist) {
      bestDist = d;
      best = g.id;
    }
  }
  if (best) return best;
  for (const g of geoms) {
    const { left, top, width, height } = g.box;
    if (width <= 0 || height <= 0) continue;
    if (pointer.x >= left && pointer.x <= left + width && pointer.y >= top && pointer.y <= top + height) {
      return g.id;
    }
  }
  return null;
}

/** Is the pointer within `tol` px of the resize handle at `handle`? Null
 *  handle (no selection, or a selection with no on-panel layout) never hits. */
export function hitTestAnnotationHandle(
  handle: { x: number; y: number } | null,
  pointer: { x: number; y: number },
  tol = 8,
): boolean {
  return !!handle && Math.hypot(handle.x - pointer.x, handle.y - pointer.y) <= tol;
}
