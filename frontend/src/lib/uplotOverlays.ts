// Passive uPlot draw-overlays: decorations rendered from persistent app state
// (reference lines, annotations, the publication axis-box frame, error bars).
// Pixels are re-derived from data coords on every draw, so overlays stay pinned
// across zoom/pan. refLinePlugin is optionally interactive (drag to move a line);
// the rest are pure draw hooks. The active drag-gesture tools live in uplotTools.
import type uPlot from "uplot";
import type { ErrorSpan } from "./errorbars";
import type { ColorScatterSpec } from "./colorscatter";
import type { RegionShade } from "./types";
// Shade drawing + the off-scale marker are a lazy chunk (lib/regionDecorLoader.ts).
import { regionDecor } from "./regionDecorLoader";
export { pickRefLine, type RefLineHit } from "./refLineHit";

/** Draw a full rectangular frame around the plot area (the "axis box" look that
 *  publications favour, esp. with the grid off). uPlot's per-axis border only
 *  gives an L; this strokes all four sides of u.bbox. (#17) */
export function axisBoxPlugin(color: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([]); // a dashed series leaves its dash on the shared context
        ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
        ctx.restore();
      },
    },
  };
}

/** MAIN #18's corner-handle resize clamp — shared by the plugin's live
 *  preview, the store's `updateAnnotation` commit, and the object menu's
 *  Size +/− entries, so the same [6, 72] px range applies everywhere a
 *  size can be set. */
export const MIN_ANNOTATION_SIZE = 6;
export const MAX_ANNOTATION_SIZE = 72;

export function clampAnnotationSize(v: number): number {
  return Math.min(MAX_ANNOTATION_SIZE, Math.max(MIN_ANNOTATION_SIZE, Math.round(v)));
}

/** Draw vertical error-bar whiskers (y ± e) for selected data columns, with
 *  optional end caps. `errorsByCol` is keyed by uPlot data-column index
 *  (1-based); each value is the per-point error magnitude (null = no bar
 *  there). Each column's whiskers use that series' own y scale (primary or
 *  secondary). Clipped to the plot area so off-range whiskers don't bleed
 *  into the axes.
 *
 *  `capHalfWidth` (CSS px) defaults to 0 — bars only. The interactive plot
 *  passes `uplotErrorRange.ERROR_CAP_HALF_PX` to match the export's caps. */
/** The fixed render alpha for Origin region shades: Origin's own
 *  fill-transparency field is UNDECODED (decode-plan #41 — no byte could be
 *  isolated across the corpus, see docs/origin_project_format.md §6.1), so
 *  this is a documented presentation choice — pale enough that data drawn
 *  over the band stays readable, matching Origin's pastel render. Mirrored
 *  exactly by calc/figure_decor.py's REGION_SHADE_ALPHA. */
export const REGION_SHADE_ALPHA = 0.25;

/** Draw filled region rectangles (Origin `Rect*` bands — e.g. film-stack
 *  shading on an SLD profile, decode-plan #41) BEHIND the grid and data:
 *  the `drawClear` hook fires right after the canvas clears, before
 *  axes/grid/series paint over it — matching Origin, which draws these
 *  under everything. Extents are data coords re-derived on every draw
 *  (pinned across zoom/pan) and clipped to the plot area; a shade tagged
 *  `axis: 1` maps its y-extent through the y2 scale when the plot has one
 *  (same fallback rule as annotationPlugin). A `fullHeight` shade spans the
 *  plot height whatever the y scale (see this module's header). */
export function regionShadePlugin(shades: RegionShade[]): uPlot.Plugin {
  return { hooks: { drawClear: (u: uPlot) => regionDecor()?.drawRegionShades(u, shades) } };
}

export function errorBarsPlugin(
  errorsByCol: Map<number, (number | null)[]>,
  color: string,
  capHalfWidth = 0,
): uPlot.Plugin {
  return {
    hooks: {
      // The drawing is the startup chunk's (lib/uplotErrorDraw.ts); gap audit 4 G8's
      // band column is shaded under the lines (drawAxes), not barred.
      drawAxes: (u: uPlot) => regionDecor()?.drawErrorBands(u, errorsByCol, color),
      draw: (u: uPlot) => regionDecor()?.drawErrorBars(u, errorsByCol, color, capHalfWidth),
    },
  };
}


/** Draw colour-mapped scatter points (MAIN #14) for every series in `specs`
 *  (keyed by uPlot data-column index, 1-based — see `colorscatter.buildColorByColumns`):
 *  each point's fill colour comes from sampling that series' colormap at its
 *  own row's z value, normalized over the channel's full [lo, hi] range. The
 *  series' NATIVE line/points are hidden by the caller (`buildOpts`, which
 *  forces `width: 0, points: {show: false}` for any series with a colorBy
 *  entry) — this plugin is the ONLY thing that draws those points, the same
 *  "hide native, draw an overlay keyed to displayed x/y" pattern
 *  `errorBarsPlugin`/`annotationPlugin` use above. `z` may be longer than the
 *  plotted x (same convention as `errorBarsPlugin`'s `errsByCol` — extra tail
 *  entries are simply unused); a null/non-finite z at a row draws no point. */
export function colorScatterPlugin(specs: Map<number, ColorScatterSpec>): uPlot.Plugin {
  return {
    hooks: {
      // The drawing is the startup chunk's (lib/uplotScatterDraw.ts, eager-budget move).
      draw: (u: uPlot) => regionDecor()?.drawColorScatter(u, specs),
    },
  };
}

/** Draw asymmetric and/or X error bars (MAIN_PLAN #36).
 *
 *  The sibling `errorBarsPlugin` draws one symmetric VERTICAL magnitude, which
 *  is all the legacy `errKeys` shape could express. This one honours what the
 *  instrument actually supplied: independent up/down magnitudes, and horizontal
 *  whiskers for x uncertainty.
 *
 *  Off-scale ends are left to the canvas clip rather than pre-filtered — a bar
 *  whose far end sits outside the view should still be drawn TO the edge, since
 *  dropping it entirely would understate the uncertainty exactly where the
 *  reader is most likely to misread it. Log axes need no special case for the
 *  same reason `valToPos` already handles them: a non-positive endpoint maps to
 *  NaN and the browser skips that segment.
 */
export function errorSpansPlugin(
  spansByCol: Map<number, ErrorSpan[]>,
  color: string,
  capHalfWidth = 0,
): uPlot.Plugin {
  return {
    hooks: {
      // As errorBarsPlugin: lib/uplotErrorDraw.ts draws; a band's X spans stay bars.
      drawAxes: (u: uPlot) => regionDecor()?.drawErrorBands(u, spansByCol, color),
      draw: (u: uPlot) => regionDecor()?.drawErrorSpans(u, spansByCol, color, capHalfWidth),
    },
  };
}
