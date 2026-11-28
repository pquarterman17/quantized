// Polygon ROI on a 2-D map: the shape, its hit-testing and the refusals. Pure
// (no React, no store, no canvas), the polygon counterpart of the box geometry in
// `lib/roi.ts`.
//
// A polygon is drawn on the axes the map shows (`space`, and the two channel
// names for a plain map, exactly as a box's `RoiRect`), as DATA coordinates of
// its vertices. The region it selects is the even-odd interior (the rule the
// backend's `calc/map_volume` applies), so a self-crossing outline is well
// defined; it is drawn as the vertices are, never replaced by a bounding box.
//
// Who can take a polygon: ROI volume (Map analysis), which sends the vertices
// as `region.kind = "polygon"`. Every consumer that reads a rectangle (box
// cuts, box stats, the batch, Crop, the pixel-extraction centre) refuses with
// `polygonRefusal`, never falling back to the polygon's bounds.

import type { RoiSpace } from "./mapBoxSpace";
import { pointToSegmentDistance } from "./shapeHit";

export type Vertex = [number, number];

export interface RoiPolygon {
  space: RoiSpace;
  axes?: [string, string]; // `space: "map"` only (lib/mapBoxSpace.ts)
  points: Vertex[];
}

/** A closed polygon needs this many vertices (the backend refuses fewer). */
export const MIN_VERTICES = 3;
/** Px radius within which a press grabs an existing vertex. */
export const VERTEX_HIT_PX = 7;

/** Shoelace area (signed; the sign is the winding, zero for a degenerate outline). */
export function signedArea(points: readonly Vertex[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** The reason `points` cannot be closed into a polygon yet, or null when they can. */
export function closeProblem(points: readonly Vertex[]): string | null {
  if (points.length < MIN_VERTICES) return `A polygon needs at least ${MIN_VERTICES} vertices (${points.length} so far).`;
  if (!points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return "A polygon vertex is not a finite number.";
  if (signedArea(points) === 0) return "The vertices lie on a line, so they enclose no area.";
  return null;
}

/** The vertices projected to px (`project` is data -> px, e.g. `mapRender.dataToPx`
 *  bound to the live payload); null when any falls outside the plot area. */
export function polygonToPx(
  points: readonly Vertex[],
  project: (x: number, y: number) => [number, number] | null,
): { x: number; y: number }[] | null {
  const out: { x: number; y: number }[] = [];
  for (const [x, y] of points) {
    const p = project(x, y);
    if (!p) return null;
    out.push({ x: p[0], y: p[1] });
  }
  return out;
}

/** Index of the vertex nearest `at` within `tol` px, or -1. */
export function vertexAt(pxPoints: readonly { x: number; y: number }[], at: { x: number; y: number }, tol: number = VERTEX_HIT_PX): number {
  let best = -1;
  let bestD = tol;
  pxPoints.forEach((p, i) => {
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** True when `at` is on the outline (within `tol` px of an edge), for the hover cursor. */
export function onOutline(pxPoints: readonly { x: number; y: number }[], at: { x: number; y: number }, tol: number = VERTEX_HIT_PX): boolean {
  return pxPoints.some((p, i) => {
    const q = pxPoints[(i + 1) % pxPoints.length]!;
    return pointToSegmentDistance(at, p.x, p.y, q.x, q.y) <= tol;
  });
}

/** The polygon with vertex `index` moved to (x, y). */
export function moveVertex(poly: RoiPolygon, index: number, x: number, y: number): RoiPolygon {
  return { ...poly, points: poly.points.map((p, i): Vertex => (i === index ? [x, y] : p)) };
}

/** The backend's `region` for a polygon (`/api/map-analysis/volume`). */
export function polygonRegion(poly: RoiPolygon): { kind: "polygon"; points: Vertex[] } {
  return { kind: "polygon", points: poly.points.map((p): Vertex => [p[0], p[1]]) };
}

/** Why a consumer that reads a rectangle cannot use the polygon drawn on the map. */
export function polygonRefusal(what: string): string {
  return `A polygon is drawn on the map, not a box: ${what} needs a rectangle. Draw a box with the Box tool, or use the polygon in Map analysis (Volume over a region).`;
}
