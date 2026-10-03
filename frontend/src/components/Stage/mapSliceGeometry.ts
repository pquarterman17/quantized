// Where the committed map slices and annotations sit in DATA coordinates —
// for the vector export (`mapFigureExport.mapFigureBody`). It mirrors the
// on-screen overlay's own endpoint rule (`MapSliceOverlay.tsx`), and
// `mapSliceGeometry.test.tsx` pins the two together, so a slice or a label is
// in the exported figure exactly when it is on the map.

import type { CutSpace } from "../../lib/mapcuts";
import type { MapAnnotation, MapSliceDef } from "../../lib/mapView";
import type { MapPayload } from "../../lib/mapdataFetch";

type Span = [number, number];
type Pt = [number, number];

const axisSpan = (axis: readonly number[]): Span | null => {
  const lo = axis[0];
  const hi = axis[axis.length - 1];
  if (lo == null || hi == null) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
};

const inSpan = (v: number, s: Span): boolean => v >= s[0] && v <= s[1];

/** A slice's two ends in data coordinates, or null when it cannot be drawn on
 *  this payload. An `h` slice spans the full x axis at its linked y, a `v`
 *  slice the full y axis at its linked x, a `seg` its own two picked points.
 *  Only the HELD coordinate decides whether an h/v slice is drawable (its
 *  other one is kept only to say where the cut was taken); a `seg` needs both
 *  ends on the map. */
export function sliceDataEnds(def: MapSliceDef, p: MapPayload): [Pt, Pt] | null {
  const xs = axisSpan(p.xAxis);
  const ys = axisSpan(p.yAxis);
  if (!xs || !ys) return null;
  const x0 = p.xAxis[0];
  const x1 = p.xAxis[p.xAxis.length - 1];
  const y0 = p.yAxis[0];
  const y1 = p.yAxis[p.yAxis.length - 1];
  if (def.kind === "seg") {
    if (!def.b) return null;
    const ok = (q: { x: number; y: number }) => inSpan(q.x, xs) && inSpan(q.y, ys);
    return ok(def.a) && ok(def.b) ? [[def.a.x, def.a.y], [def.b.x, def.b.y]] : null;
  }
  if (def.kind === "h") return inSpan(def.a.y, ys) ? [[x0, def.a.y], [x1, def.a.y]] : null;
  return inSpan(def.a.x, xs) ? [[def.a.x, y1], [def.a.x, y0]] : null; // top to bottom, as drawn
}

/** Is this annotation on the map: recorded in the space shown, inside the axes? */
export function annotationOnMap(ann: MapAnnotation, p: MapPayload, space: CutSpace | null): boolean {
  const xs = axisSpan(p.xAxis);
  const ys = axisSpan(p.yAxis);
  return ann.space === space && xs !== null && ys !== null && inSpan(ann.x, xs) && inSpan(ann.y, ys);
}

/** The slices and labels the map shows, in data coordinates — what its export draws. */
export function mapMarks(
  p: MapPayload,
  slices: readonly MapSliceDef[],
  annotations: readonly MapAnnotation[],
  space: CutSpace | null,
): { lines: [number, number, number, number][]; labels: { x: number; y: number; text: string }[] } {
  const lines = slices.flatMap((def) => {
    const ends = def.space === space ? sliceDataEnds(def, p) : null;
    return ends ? [[ends[0][0], ends[0][1], ends[1][0], ends[1][1]] as [number, number, number, number]] : [];
  });
  const labels = annotations.filter((a) => annotationOnMap(a, p, space)).map(({ x, y, text }) => ({ x, y, text }));
  return { lines, labels };
}
