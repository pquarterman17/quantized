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

/** The inverse of `overPointerToCanvas` for the zero-offset (full-canvas)
 *  `bbox` case `annotationPlugin`'s `ready` block always uses (`{left:0,
 *  top:0,width:cw,height:ch}`): CANVAS px -> CSS px relative to `over` (the
 *  frame `u.posToVal` expects). Composed of the same two steps
 *  `annotationPlugin`'s pre-MAIN-#21 `clampToCanvas` inlined (canvas px ->
 *  root-relative CSS via the inverse scale, then root-relative -> over-
 *  relative by subtracting the two elements' rect offset) — factored out
 *  here, pure (plain rect records, no live DOM), so MAIN #21's data<->page
 *  anchor toggle can compute a page annotation's would-be data coordinate
 *  without needing its own copy of this frame math, and so the round-trip
 *  with `overPointerToCanvas` is unit-testable directly. `rootRect` carries
 *  the SAME per-axis width/height this file's forward conversion does (not
 *  the DPR-only single-scale `clampToCanvas` used before #21 factored this
 *  out) so the two functions are true inverses on a non-square canvas. */
export function canvasToOverCss(
  canvasPx: { x: number; y: number },
  canvas: { width: number; height: number },
  rootRect: { width: number; height: number; left: number; top: number },
  overRect: { left: number; top: number },
): { x: number; y: number } {
  const scale = rootRect.width > 0 && canvas.width > 0 ? canvas.width / rootRect.width : 1;
  const sy = rootRect.height > 0 && canvas.height > 0 ? canvas.height / rootRect.height : scale;
  return {
    x: canvasPx.x / scale - (overRect.left - rootRect.left),
    y: canvasPx.y / sy - (overRect.top - rootRect.top),
  };
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

/** Per-dispatch mousemove "hover cursor" claim (bug-hunt Bug 2: shape/
 *  annotation coexistence). `uplotShapes.shapesPlugin` and
 *  `uplotOverlays.annotationPlugin` each attach an INDEPENDENT mousemove
 *  listener to the SAME `u.root` node — every listener wants to set a
 *  "move"/"nwse-resize" cursor on its own positive hit and reset to
 *  "default" on a miss. Two independent listeners on one node means the
 *  LATER-registered one's blanket "default" reset silently clobbers the
 *  EARLIER one's positive cursor (`uplotOpts.ts` always registers shapes
 *  before annotations, so a shape's "move" cursor was being overwritten by
 *  annotationPlugin's own miss on every hover). Stashing a flag on the
 *  MouseEvent instance itself — a NEW instance per dispatch, so there is no
 *  stale-state risk across events, unlike a DOM/dataset marker that would
 *  need explicit reset — lets a later listener know an earlier one already
 *  claimed the cursor THIS event, so it should leave it alone rather than
 *  reset it, while a genuine "nothing hit, restore default" still happens
 *  correctly when NEITHER plugin claims it (each plugin only skips its OWN
 *  default-write when the event is already claimed; the first plugin to run
 *  in a "hit nothing" event still resets to default, so hovering off every
 *  overlay is never stuck at a stale cursor). */
export function claimCursor(e: MouseEvent): void {
  (e as MouseEvent & { __qzCursorClaimed?: boolean }).__qzCursorClaimed = true;
}

/** Did an earlier same-event listener already `claimCursor`? See its doc. */
export function cursorClaimed(e: MouseEvent): boolean {
  return (e as MouseEvent & { __qzCursorClaimed?: boolean }).__qzCursorClaimed === true;
}
