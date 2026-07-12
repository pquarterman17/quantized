// Pure hit-test geometry for pointer-mode SHAPE direct manipulation (MAIN
// #27) — segment distance (line/arrow, incl. the arrowhead: it's drawn AT
// the endpoint, on the segment, so the segment test already covers it),
// rect-edge/interior, and ellipse-edge/interior. Split from uplotShapes.ts
// the same way annotationHit.ts splits from uplotOverlays.ts (see that
// file's header for why) — the geometry stays unit-testable without a
// canvas stub, and draw/hit-test share ONE implementation so they can never
// silently drift apart. Canvas-frame pointer conversion (the DPR bug class
// documented in annotationHit.ts) is NOT reimplemented here — callers
// (uplotShapes.ts) convert the pointer via annotationHit's
// overPointerToCanvas first, same as annotationPlugin does.

/** One shape's hit-test geometry, CANVAS pixels — both endpoints (line/arrow
 *  p1->p2; rect/ellipse the bounding box's two opposite corners), derived
 *  from `uplotShapes.shapeLayout` (the SAME geometry the draw pass uses). */
export interface ShapeGeom {
  id: string;
  kind: "arrow" | "line" | "rect" | "ellipse";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Perpendicular distance from `p` to the SEGMENT (x1,y1)-(x2,y2), clamped to
 *  the segment's own extent (not the infinite line through it) — the shared
 *  math for a line/arrow body hit, and for one edge of a rect's 4-segment
 *  perimeter below. A zero-length segment degrades to point distance. */
export function pointToSegmentDistance(
  p: { x: number; y: number },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - x1, p.y - y1);
  const t = Math.min(1, Math.max(0, ((p.x - x1) * dx + (p.y - y1) * dy) / lenSq));
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
}

/** Is `p` inside the axis-aligned rect spanned by two opposite corners
 *  (order-independent — a shape's x1/y1/x2/y2 need not be already
 *  normalized to min/max)? */
export function pointInRect(
  p: { x: number; y: number },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
}

/** Distance from `p` to the NEAREST of the rect's four perimeter segments —
 *  the exact "on the edge" test (not an approximation), reusing
 *  `pointToSegmentDistance` per side. */
export function distanceToRectEdge(
  p: { x: number; y: number },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return Math.min(
    pointToSegmentDistance(p, left, top, right, top),
    pointToSegmentDistance(p, right, top, right, bottom),
    pointToSegmentDistance(p, right, bottom, left, bottom),
    pointToSegmentDistance(p, left, bottom, left, top),
  );
}

/** The ellipse "radial parameter" of `p` relative to its center + semi-axes:
 *  0 at the center, 1 exactly ON the ellipse boundary, >1 outside. Infinity
 *  for a degenerate (zero-area) ellipse — never "on" it. */
export function ellipseParam(
  p: { x: number; y: number },
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): number {
  if (!(rx > 0) || !(ry > 0)) return Infinity;
  return Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
}

/** Approximate pixel distance from `p` to the ellipse boundary: `|param-1|`
 *  scaled by the tighter semi-axis — exact only near-circular, but plenty
 *  for an interactive hit tolerance (a handful of px), not a geometry
 *  export. */
export function ellipseEdgeDistance(
  p: { x: number; y: number },
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): number {
  const param = ellipseParam(p, cx, cy, rx, ry);
  if (!Number.isFinite(param)) return Math.hypot(p.x - cx, p.y - cy);
  return Math.abs(param - 1) * Math.min(rx, ry);
}

/** The bounding-box center + semi-axes for a rect/ellipse shape's two
 *  opposite-corner geometry — shared by the ellipse hit-test AND the draw
 *  pass (uplotShapes.ts) so they can never disagree on where "the ellipse"
 *  actually is. */
export function boundingEllipse(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { cx: number; cy: number; rx: number; ry: number } {
  return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2 };
}

/** Distance from `p` to a shape's OWN edge/segment (line/arrow: the segment
 *  itself; rect: its perimeter; ellipse: its boundary curve, approximated).
 *  Skips a shape with any non-finite coordinate (Infinity — never hits). */
function shapeEdgeDistance(g: ShapeGeom, p: { x: number; y: number }): number {
  if (!Number.isFinite(g.x1) || !Number.isFinite(g.y1) || !Number.isFinite(g.x2) || !Number.isFinite(g.y2)) {
    return Infinity;
  }
  if (g.kind === "arrow" || g.kind === "line") {
    return pointToSegmentDistance(p, g.x1, g.y1, g.x2, g.y2);
  }
  if (g.kind === "rect") {
    return distanceToRectEdge(p, g.x1, g.y1, g.x2, g.y2);
  }
  const { cx, cy, rx, ry } = boundingEllipse(g.x1, g.y1, g.x2, g.y2);
  return ellipseEdgeDistance(p, cx, cy, rx, ry);
}

/** Nearest shape under the pointer: an EDGE/segment hit (any kind) within
 *  `tol` wins over a translucent-INTERIOR hit (rect/ellipse only) — the edge
 *  is the more precise target, matching `annotationHit.hitTestAnnotationBody`'s
 *  "the more precise geometry wins" two-pass shape. Among overlapping
 *  interior hits, the TOPMOST (last in `geoms`, matching z/draw order) wins.
 *  Null when nothing is hit (including an empty list). */
export function hitTestShapeBody(
  geoms: readonly ShapeGeom[],
  pointer: { x: number; y: number },
  tol = 8,
): string | null {
  let best: string | null = null;
  let bestDist = tol;
  for (const g of geoms) {
    const d = shapeEdgeDistance(g, pointer);
    if (d <= bestDist) {
      bestDist = d;
      best = g.id;
    }
  }
  if (best) return best;
  for (let i = geoms.length - 1; i >= 0; i--) {
    const g = geoms[i];
    if (!Number.isFinite(g.x1) || !Number.isFinite(g.y1) || !Number.isFinite(g.x2) || !Number.isFinite(g.y2)) {
      continue;
    }
    if (g.kind === "rect" && pointInRect(pointer, g.x1, g.y1, g.x2, g.y2)) return g.id;
    if (g.kind === "ellipse") {
      const { cx, cy, rx, ry } = boundingEllipse(g.x1, g.y1, g.x2, g.y2);
      if (ellipseParam(pointer, cx, cy, rx, ry) <= 1) return g.id;
    }
  }
  return null;
}

/** A shape's resize handles in CANVAS px: line/arrow get its TWO endpoints
 *  (index 0 = p1, index 1 = p2); rect/ellipse get FOUR corners of the
 *  x1/y1-x2/y2 bounding box, in (x1,y1) / (x2,y1) / (x2,y2) / (x1,y2) order
 *  — each corner mixes one endpoint's x with the OTHER's y, so dragging one
 *  never moves the opposite corner (see `shapeReshapeFields`'s doc for the
 *  matching field-patch mapping). */
export function shapeHandles(
  kind: ShapeGeom["kind"],
  g: { x1: number; y1: number; x2: number; y2: number },
): { x: number; y: number }[] {
  if (kind === "line" || kind === "arrow") {
    return [
      { x: g.x1, y: g.y1 },
      { x: g.x2, y: g.y2 },
    ];
  }
  return [
    { x: g.x1, y: g.y1 },
    { x: g.x2, y: g.y1 },
    { x: g.x2, y: g.y2 },
    { x: g.x1, y: g.y2 },
  ];
}

/** Which handle (index into `shapeHandles`'s output) the pointer is within
 *  `tol` px of, or null. Nearest wins on a tie. */
export function hitTestShapeHandle(
  handles: readonly { x: number; y: number }[],
  pointer: { x: number; y: number },
  tol = 8,
): number | null {
  let best: number | null = null;
  let bestDist = tol;
  handles.forEach((h, i) => {
    const d = Math.hypot(h.x - pointer.x, h.y - pointer.y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Which DATA (or page-fraction, same field names) properties a dragged
 *  handle should patch — the reshape counterpart of `shapeHandles`' pixel
 *  geometry. Line/arrow: handle 0 patches `{x1,y1}`, handle 1 `{x2,y2}` (its
 *  own endpoint moves, the other stays put). Rect/ellipse: each of the 4
 *  corners patches ONE x-field + ONE y-field, matching `shapeHandles`'
 *  corner order, so the OPPOSITE corner is always the one left untouched
 *  (e.g. dragging the top-left corner patches `x1`/`y1`, leaving `x2`/`y2` —
 *  the bottom-right corner — fixed). Falls back to handle 0's mapping for an
 *  out-of-range index (defensive; every real caller passes a valid one). */
export function shapeReshapeFields(
  kind: ShapeGeom["kind"],
  handle: number,
): { xField: "x1" | "x2"; yField: "y1" | "y2" } {
  if (kind === "line" || kind === "arrow") {
    return handle === 1 ? { xField: "x2", yField: "y2" } : { xField: "x1", yField: "y1" };
  }
  switch (handle) {
    case 1:
      return { xField: "x2", yField: "y1" };
    case 2:
      return { xField: "x2", yField: "y2" };
    case 3:
      return { xField: "x1", yField: "y2" };
    default:
      return { xField: "x1", yField: "y1" };
  }
}
