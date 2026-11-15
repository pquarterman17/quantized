// Symbol details (origin gap audit 4 G10), the canvas half: a series' marker
// EDGE colour, FILL colour, fill opacity and "symbol every N points". Part of
// the lazy marks chunk (`marksImpl` re-exports it; `marksLoader.usesMarks`
// asks for it), so a plot that uses none of them pays nothing. The export is
// `calc/figure_symbols.py`, which follows the same rules:
//
// * an edge or fill colour, or an opacity, fills every closed glyph (the circle
//   included, as matplotlib's default face is filled) with the fill colour,
//   default the series colour; the opacity applies to the fill only;
// * an open symbol (`markerFill: "hollow"`) keeps no fill, and an open glyph
//   (plus, cross, star) has none to fill;
// * the skip keeps every Nth DRAWN point (finite x and y) of the series,
//   counted in row order over all its rows, so a zoom never moves which points
//   carry a symbol.

import type uPlot from "uplot";

import { validAlpha, validEvery } from "./symbolSanitize";
import type { SeriesStyle } from "./types";
import { translucent } from "./uplotFill";

/** The rows of every `n`th drawn point of a series (a uPlot points filter). */
export function everyNth(n: number): uPlot.Series.Points.Filter {
  return (u, sidx) => {
    const xs = u.data[0] as readonly (number | null | undefined)[];
    const ys = u.data[sidx] as readonly (number | null | undefined)[];
    const out: number[] = [];
    for (let i = 0, k = 0; i < ys.length; i++) {
      const x = xs[i];
      const y = ys[i];
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (k++ % n === 0) out.push(i);
    }
    return out;
  };
}

/** `points` (what `markers.seriesPoints` built for this series, drawn in
 *  `stroke`) with the style's symbol details laid over it. `color` resolves a
 *  stored edge / fill colour (a token or hex) for this canvas, contrast-checked
 *  like the stroke. Unchanged when the style sets none. */
export function symbolPoints(
  points: uPlot.Series.Points,
  style: SeriesStyle | undefined,
  stroke: string,
  color: (c: string) => string,
): uPlot.Series.Points {
  if (!style || !points.show) return points;
  const out = { ...points };
  const alpha = validAlpha(style.markerAlpha) ? style.markerAlpha : undefined; // as the export (review L5)
  if (style.markerEdge || style.markerFillColor || alpha != null) {
    out.stroke = style.markerEdge ? color(style.markerEdge) : stroke;
    // A closed glyph already has a fill; the circle (no `paths`) gets one.
    if (style.markerFill !== "hollow" && (!points.paths || points.fill)) {
      const face = style.markerFillColor ? color(style.markerFillColor) : stroke;
      out.fill = alpha != null && alpha < 1 ? translucent(face, Math.round(alpha * 100)) : face;
    }
  }
  if (validEvery(style.markerEvery)) out.filter = everyNth(style.markerEvery);
  return out;
}
