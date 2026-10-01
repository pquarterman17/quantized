// The per-series half of `buildOpts` (lib/uplotOpts.ts): uPlot's `series`
// array and the fill-between `bands`, from the payload and the per-series
// style args. Moved here verbatim so PlotViewport can re-resolve a LIVE
// instance's paint (colour, width, dash, fill colour, visibility) through the
// very code a rebuild runs, instead of tearing uPlot down for a display-only
// edit (docs/performance_envelope.md; see lib/uplotLivePaint.ts).

import type uPlot from "uplot";

import { resolveDrawColor } from "./contrastColor";
import { seriesPoints, seriesTrace } from "./markers";
import type { PlotPayload } from "./plotdata";
import { DASH, resolveSeriesStyle, seriesColor } from "./seriesStyleCycle";
import { resolveFillBands, seriesFillProps } from "./uplotFill";
import type { BuildOptsArgs } from "./uplotOpts";

/** The per-series style inputs `buildSeriesDefs` reads (all of them). */
export type SeriesDefArgs = Pick<
  BuildOptsArgs,
  | "seriesStyles"
  | "seriesCycle"
  | "hidden"
  | "colorByColumns"
  | "defaultTrace"
  | "baseLineWidth"
  | "plotted"
  | "steppedPaths"
  | "steppedPathsPre"
  | "steppedPathsMid"
  | "linearPaths"
  | "pointsPaths"
>;

/** The resolved plot colours a series' paint is derived from (the window's
 *  effective background, item 18 — see `resolvePlotBg`). */
export interface SeriesColors {
  accentColor: string;
  inkColor: string;
  inkDimColor: string;
  isDarkBg: boolean;
}

/** uPlot `series` (index 0 = x) and `bands` for `payload`. `labels[i]` is
 *  display series `i`'s resolved legend label (undefined leaves it unset). */
export function buildSeriesDefs(
  payload: PlotPayload,
  args: SeriesDefArgs,
  labels: readonly (string | undefined)[],
  xAscending: boolean,
  colors: SeriesColors,
): { series: uPlot.Series[]; bands: uPlot.Band[] } {
  const { seriesStyles } = args;
  const { accentColor, inkColor, inkDimColor, isDarkBg } = colors;
  // Non-monotonic x: wrap a path builder so it ignores uPlot's (collapsed)
  // index window and draws the full acquisition order. See `linearPaths` docs.
  const fullLine = (b: uPlot.Series.PathBuilder): uPlot.Series.PathBuilder =>
    (u, sidx) => b(u, sidx, 0, u.data[0].length - 1);
  const fullPoints = (b: uPlot.Series.Points.PathBuilder): uPlot.Series.Points.PathBuilder =>
    (u, sidx, _i0, _i1, filt) => b(u, sidx, 0, u.data[0].length - 1, filt);
  /** Point-marker config for one series honoring the loop fix. */
  const loopPoints = (p: uPlot.Series.Points): uPlot.Series.Points => {
    if (xAscending || !p.show) return p;
    if (p.paths) return { ...p, paths: fullPoints(p.paths) };
    return args.pointsPaths ? { ...p, paths: fullPoints(args.pointsPaths) } : p;
  };

  // Resolved stroke per display series, populated during the series build
  // below — captured here (rather than recomputed) so the post-loop band
  // resolution (`resolveFillBands`) can derive a band's fill colour from the
  // EXACT stroke its "from" series draws with, including the literal-colour
  // contrast substitution above.
  const strokes: string[] = [];
  const seriesArr: uPlot.Series[] = [
    // x series: declare its sort order so uPlot autoscales correctly. Ascending
    // (the common case: temperature/2θ/time) keeps the fast endpoint path;
    // non-monotonic x (hysteresis loops, swept-back scans) must scan all points.
    { sorted: xAscending ? 1 : 0 },
    ...payload.series.map((s, i) => {
      // The EFFECTIVE style: this series' own, plus P3.3's auto dash/glyph at
      // this series' DISPLAY POSITION — but only for a caller that opted in by
      // passing `seriesCycle` (the identity function otherwise, returning the
      // caller's own reference). The SAME resolver, at the SAME position,
      // `lib/exportStyles.ts` calls — see `seriesStyleCycle.ts`'s header.
      const style = resolveSeriesStyle(seriesStyles?.[i], i, args.seriesCycle ?? null);
      // Literal per-series overrides (e.g. an Origin-imported figure's
      // saved line colour) are checked for contrast against THIS window's
      // effective background and swapped for the ink token when they'd be
      // invisible (a literal black stroke on our dark canvas, or literal
      // white on a "light" override) — never mutates the stored style, so
      // a theme/background switch re-resolves live. Default palette
      // colours (`--series-N`) pass through unchanged (already
      // theme-designed for contrast; see `resolveDrawColor`'s doc).
      const stroke = resolveDrawColor(seriesColor(i, style), isDarkBg, inkColor);
      strokes[i] = stroke;
      const label = labels[i];
      const scale = (s.axis ?? 0) === 1 ? "y2" : "y";
      const show = !args.hidden?.[i]; // interactive legend visibility
      // Selected companion (#50 brush): accent, filled larger markers, no line.
      if (s.selected) {
        return { label, scale, stroke: accentColor, fill: accentColor, width: 0, points: loopPoints({ show: true, size: 7 }), show };
      }
      // Muted "excluded" companion (grey mode): faint hollow markers, no line.
      if (s.muted) {
        return { label, scale, stroke: inkDimColor, width: 0, points: loopPoints({ show: true, size: 5 }), show };
      }
      // Peak markers: points only, no connecting line.
      if (s.kind === "points") {
        return { label, scale, stroke, fill: stroke, width: 0, points: loopPoints({ show: true, size: 8 }), show };
      }
      // Colour-mapped scatter (MAIN #14): `colorScatterPlugin` (registered
      // above whenever `args.colorByColumns` is non-empty) draws every point
      // for this column itself, keyed to the z channel — so the native line
      // AND points are hidden entirely here to avoid double-drawing. No fill
      // (a fill-under/between a colour-mapped point cloud isn't meaningful).
      if (args.colorByColumns?.has(i + 1)) {
        return { label, scale, stroke, width: 0, points: { show: false }, show };
      }
      // Default trace shape (Preferences) when the series has no explicit style:
      // Scatter = markers, no line; Line + markers = both; Step = stepped line.
      const trace = seriesTrace(style, args.defaultTrace ?? "Line"); // an explicit style opts out
      const width = style?.width ?? (trace === "Scatter" ? 0 : (args.baseLineWidth ?? 1.5));
      const dash = style?.line ? DASH[style.line] : undefined;
      // Markers: glyph + size for an explicit `marker` style, or the plain 5px
      // circle of the Scatter / Line + markers default trace —
      // `markers.seriesPoints` owns that decision now, and its doc records why
      // the two branches must NOT be merged (the export emits a marker only for
      // an explicit `marker`).
      const points = seriesPoints(style, trace, stroke);
      // Fill-under (MAIN #13): uPlot's native `series.fill`/`fillTo`, derived
      // from this series' own resolved stroke. `{vs}` band fills are NOT a
      // per-series prop — see `resolveFillBands` below (opts.bands).
      const def: uPlot.Series = {
        label, scale, stroke, width, dash, points: loopPoints(points), show,
        ...seriesFillProps(style?.fill, stroke),
      };
      // Per-series step alignment (SeriesStyle.step, GAP_PLOTTYPES "step"
      // mark) — a MORE SPECIFIC override than the "Step" default-trace
      // preference below, so it's checked first: a step-marked series
      // renders correctly regardless of the ambient default trace.
      if (style?.step) {
        const builder =
          style.step === "pre" ? args.steppedPathsPre
          : style.step === "mid" ? args.steppedPathsMid
          : args.steppedPaths;
        if (builder) def.paths = xAscending ? builder : fullLine(builder);
      } else if (trace === "Step" && !seriesStyles?.[i]?.line && args.steppedPaths) {
        // Stepped trace: apply the caller-supplied step-after path builder
        // (there's no per-series line-shape override, so it's a global default).
        // RAW list, not the resolved `style`: a P3.3 auto dash is a DEFAULT and
        // must not read as an explicit choice, or the pref would un-step this.
        def.paths = xAscending ? args.steppedPaths : fullLine(args.steppedPaths);
      } else if (!xAscending && width > 0 && args.linearPaths) {
        // Loop rendering: draw the line over every point in acquisition order.
        def.paths = fullLine(args.linearPaths);
      }
      return def;
    }),
  ];
  // Fill-between (MAIN #13): a top-level uPlot Band per series requesting
  // `fill: {vs: channel}` — see uplotFill.resolveFillBands's doc for the
  // "vs must be currently plotted" fallback.
  const bands = resolveFillBands(args.plotted ?? [], seriesStyles ?? [], (i) => strokes[i] ?? accentColor);
  return { series: seriesArr, bands };
}
