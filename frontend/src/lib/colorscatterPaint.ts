// The drawing half of lib/colorscatter.ts (bundle diet slice 32): the per-point
// fill rule and the marker painter. Only the lazy plot chunks draw with them
// (the colour-scatter and mark startup chunks, the Graph Builder preview), so
// they ship with those; lib/colorscatter.ts re-exports them with `export *`.

import { colormap, normalize } from "./colormap";
import type { ColorScatterSpec } from "./colorscatter";
import { FILLED_SHAPES, markerSubpaths } from "./markers";
import type { MarkerShape } from "./types";

/** The fill of row `i`'s point: its z value normalized over [lo, hi] (linear;
 *  a degenerate range reads 0) through the colormap, as `rgb(r, g, b)` — or
 *  null for a non-finite z (the point is not drawn). The backend port is
 *  `calc.figure_colorscatter.gradient_colors`. */
export function colorScatterFill(spec: ColorScatterSpec, i: number): string | null {
  const t = normalize(spec.z[i] ?? NaN, spec.lo, spec.hi, false);
  if (t == null) return null;
  const [r, g, b] = colormap(spec.colormap, t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Paint one colour-mapped point at (px, py): a circle of radius `r`, or a
 *  `markerSubpaths` glyph (closed glyphs fill, open ones stroke). */
export function paintColorPoint(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  r: number,
  fill: string,
  shape: MarkerShape = "circle",
  hollow = false,
): void {
  const closed = shape === "circle" || FILLED_SHAPES.has(shape);
  ctx.fillStyle = ctx.strokeStyle = fill;
  ctx.beginPath();
  if (shape === "circle") ctx.arc(px, py, r, 0, Math.PI * 2);
  for (const sub of markerSubpaths(shape, px, py, r + 1)) {
    sub.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (closed) ctx.closePath();
  }
  if (closed && !hollow) ctx.fill();
  else ctx.stroke();
}
