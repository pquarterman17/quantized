// The Preferences "Default trace" (Scatter / Line + markers / Step) on the
// export wire. The canvas draws every series without an explicit style in
// that trace (`uplotSeries.buildSeriesDefs`, `markers.markerDecision`), but the
// preference never rode the wire, so an ambient Scatter plot exported as lines
// (`tests/fixtures/wire/default_trace.json`). This lays the same rule over a
// request's per-series styles, entry by entry, so explicit choices still win:
//   * Scatter         -> no line unless a width is set; a marker unless one is.
//   * Line + markers  -> a marker unless one is set.
//   * Step            -> step-after unless the series has its own step or line
//                        style (the canvas checks the RAW style, not the P3.3
//                        auto dash, so `rawStyles` is the view's own map).
// A marker it adds is the canvas' plain circle at the canvas' size
// (`markers.DEFAULT_MARKER_PX`), not the preset's.
//
// Every builder applies it: `figureSpec.buildFigureSpecForView` (the Stage,
// saved documents, page panels, the Figure Builder's canonical path, report
// figures), `figurebuilder/legacyFigure` (its live-plot mirror) and
// `spatialPageExport` (a multi-panel window's page). It covers
// a flat, grouped or encoded request (`series_styles` is `y_keys`-aligned on
// all three; the backend expands it per level) and a facet grid (each panel
// series' own `style`). A GRADIENT encoding is left alone: its series are
// colour-mapped scatters on both sides, which the trace does not reach.
//
// NOT the Graph Builder's own requests: its canvas (`graphbuilder/previewCanvas`)
// draws the spec's mark (scatter / line / step, markers per `showMarkers`) and
// never reads the preference, so its encoded Export and the Publication Preview
// seed send the mark (`plotSpecFigure.stylesForMark`). Its xy Export applies the
// spec to the Stage and exports that as the Stage draws it: the mark commits an
// EXPLICIT style (`plotspec.markSeriesStyle`, `SeriesStyle.explicit`), which the
// trace leaves alone here as the canvas does (`markers.seriesTrace`). A facet
// panel series reads `explicit` off its channel when the panel names its
// channels, else off the plotted set as a whole (a mark styles every Y at once).

import type { FigureSpec } from "./api/figures";
import { DEFAULT_MARKER_PX, seriesTrace } from "./markers";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { DefaultTrace, SeriesStyle } from "./types";

/** The style fields the rule reads off a series' RAW style: its own `line`
 *  (the Step rule) and `explicit` (no trace at all). */
type RawLine = { line?: unknown; explicit?: boolean } | null | undefined;

function traced(
  entry: ExportSeriesStyle | null | undefined,
  raw: RawLine,
  trace: DefaultTrace,
): ExportSeriesStyle | null {
  if (seriesTrace(raw, trace) === "Line" || entry?.color_by != null || entry?.line === "none") return entry ?? null;
  const out: ExportSeriesStyle = { ...entry };
  if (trace === "Scatter" && out.width == null) out.width = 0;
  if ((trace === "Scatter" || trace === "Line + markers") && !out.marker) {
    out.marker = true;
    out.marker_size = DEFAULT_MARKER_PX;
  }
  if (trace === "Step" && !out.step && !raw?.line) out.step = "post";
  return Object.keys(out).length > 0 ? out : null;
}

/** `styles` (aligned 1:1 with `keys`) with the default trace laid over it;
 *  `styles` itself for the Line trace. A missing entry is unstyled. */
export function traceSeriesStyles(
  styles: (ExportSeriesStyle | null)[] | null | undefined,
  keys: readonly (number | string)[],
  trace: DefaultTrace | undefined,
  rawStyles: Readonly<Record<number, RawLine>>,
): (ExportSeriesStyle | null)[] | null | undefined {
  if (!trace || trace === "Line" || keys.length === 0) return styles;
  return keys.map((k, i) => traced(styles?.[i], typeof k === "number" ? rawStyles[k] : undefined, trace));
}

/** `spec` with the default trace laid over its `series_styles` or, for a facet
 *  grid, every panel series' `style` (see the module header); `spec` itself
 *  for the Line trace or a request it skips. */
export function withDefaultTrace(
  spec: FigureSpec,
  trace: DefaultTrace | undefined,
  rawStyles: Record<number, SeriesStyle>,
): FigureSpec {
  if (!trace || trace === "Line" || spec.encoding?.gradient_col != null) return spec;
  if (spec.facets) {
    // A panel series' style IS its channel's raw style (FEATURE-001, no cycle),
    // so its own `line` is the raw one the Step rule reads; `explicit` does not
    // ride the wire, so it comes from the channel (see the module header).
    const own = (k: number | string | undefined) => typeof k === "number" && rawStyles[k]?.explicit === true;
    const allOwn = (spec.y_keys?.length ?? 0) > 0 && (spec.y_keys ?? []).every(own);
    return {
      ...spec,
      facets: spec.facets.map((panel) => ({
        ...panel,
        series: panel.series.map((s, i) => {
          const explicit = panel.channels ? own(panel.channels[i]) : allOwn;
          return { ...s, style: traced(s.style, { line: s.style?.line, explicit }, trace) };
        }),
      })),
    };
  }
  const keys = spec.y_keys;
  if (!keys?.length) return spec;
  return { ...spec, series_styles: traceSeriesStyles(spec.series_styles, keys, trace, rawStyles) ?? undefined };
}
