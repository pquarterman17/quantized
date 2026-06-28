// Marker glyphs for series points. uPlot draws filled circles by default; other
// shapes need a custom `points.paths` builder. The geometry (markerSubpaths) is a
// pure function of centre + radius so it's unit-testable without a canvas; the
// thin markerPaths wrapper turns it into Path2D at draw time. (#14)

import type uPlot from "uplot";

import type { MarkerShape } from "./types";

export const MARKER_SHAPES: { value: MarkerShape; label: string }[] = [
  { value: "circle", label: "● circle" },
  { value: "square", label: "■ square" },
  { value: "triangle", label: "▲ triangle" },
  { value: "downtriangle", label: "▼ triangle (down)" },
  { value: "diamond", label: "◆ diamond" },
  { value: "plus", label: "+ plus" },
  { value: "cross", label: "✕ cross" },
  { value: "star", label: "✳ asterisk" },
];

/** Closed (filled) shapes vs. open (stroke-only) glyphs. */
export const FILLED_SHAPES: ReadonlySet<MarkerShape> = new Set<MarkerShape>([
  "square",
  "triangle",
  "downtriangle",
  "diamond",
]);

/** The subpaths (each a polyline of [x,y]) for a glyph centred at (cx,cy) with
 *  radius r. Filled shapes are single closed polygons; open glyphs are line
 *  segments. `circle` returns [] (uPlot's built-in renderer handles it). */
export function markerSubpaths(
  shape: MarkerShape,
  cx: number,
  cy: number,
  r: number,
): [number, number][][] {
  const d = r * 0.7; // diagonal reach for the asterisk
  switch (shape) {
    case "square":
      return [[[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]];
    case "triangle":
      return [[[cx, cy - r], [cx + r, cy + r], [cx - r, cy + r]]];
    case "downtriangle":
      return [[[cx, cy + r], [cx - r, cy - r], [cx + r, cy - r]]];
    case "diamond":
      return [[[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]]];
    case "plus":
      return [
        [[cx - r, cy], [cx + r, cy]],
        [[cx, cy - r], [cx, cy + r]],
      ];
    case "cross":
      return [
        [[cx - r, cy - r], [cx + r, cy + r]],
        [[cx - r, cy + r], [cx + r, cy - r]],
      ];
    case "star":
      return [
        [[cx - r, cy], [cx + r, cy]],
        [[cx, cy - r], [cx, cy + r]],
        [[cx - d, cy - d], [cx + d, cy + d]],
        [[cx - d, cy + d], [cx + d, cy - d]],
      ];
    default:
      return []; // circle
  }
}

/** A uPlot `points.paths` builder for a glyph, or undefined for the default
 *  circle (let uPlot draw it). Builds one Path2D over all visible points. */
export function markerPaths(
  shape: MarkerShape,
  size: number,
): uPlot.Series.Points.PathBuilder | undefined {
  if (shape === "circle") return undefined;
  const r = size / 2;
  const closed = FILLED_SHAPES.has(shape);
  return (u, sidx, i0, i1) => {
    const path = new Path2D();
    const xd = u.data[0] as (number | null)[];
    const yd = u.data[sidx] as (number | null)[];
    const yScale = u.series[sidx].scale ?? "y";
    for (let i = i0; i <= i1; i++) {
      const xv = xd[i];
      const yv = yd[i];
      if (xv == null || yv == null) continue;
      const cx = u.valToPos(xv, "x", true);
      const cy = u.valToPos(yv, yScale, true);
      for (const sub of markerSubpaths(shape, cx, cy, r)) {
        sub.forEach(([px, py], k) => (k === 0 ? path.moveTo(px, py) : path.lineTo(px, py)));
        if (closed) path.closePath();
      }
    }
    return { stroke: path, fill: closed ? path : null };
  };
}
