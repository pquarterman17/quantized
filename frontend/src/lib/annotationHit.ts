// Pure hit-test geometry for pointer-mode annotation direct manipulation
// (MAIN #18). An annotation is a dot + a label, not a bare point, so this
// doesn't reuse pointGesture.ts's point-only hitTestPoints (uplotAnchors'/
// peakMarkerHit's marker gestures) — a hit needs BOTH a point test (the dot)
// and a rect test (the label's measured text extents). Kept separate from
// uplotOverlays.ts (which owns the canvas draw + drag wiring) so the geometry
// math is unit-testable without a canvas stub — the same draw/hit-test split
// pointGesture.ts uses, and for the same reason its header warns about: one
// implementation, so draw and hit-test can never silently drift apart.

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
