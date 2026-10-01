// The Preferences "Default trace" (Scatter / Line + markers / Step) on the LIVE
// Stage export. The canvas draws every series without an explicit style in
// that trace (`uplotSeries.buildSeriesDefs`, `markers.markerDecision`), but the
// preference never rode the wire, so an ambient Scatter plot exported as lines
// (`tests/fixtures/wire/default_trace.json`). This lays the same rule over the
// request's per-series list, entry by entry, so explicit choices still win:
//   * Scatter         -> no line unless a width is set; a marker unless one is.
//   * Line + markers  -> a marker unless one is set.
//   * Step            -> step-after unless the series has its own step or line
//                        style (the canvas checks the RAW style, not the P3.3
//                        auto dash, so `rawStyles` is the view's own map).
// The marker is the plain circle at the preset's size, like an explicit marker
// with no size. Facet and encoded requests are left alone: their series do not
// line up with `y_keys`.

import type { FigureSpec } from "./api/figures";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { DefaultTrace, SeriesStyle } from "./types";

function traced(
  entry: ExportSeriesStyle | null,
  raw: SeriesStyle | undefined,
  trace: DefaultTrace,
): ExportSeriesStyle | null {
  if (entry?.color_by != null || entry?.line === "none") return entry;
  const out: ExportSeriesStyle = { ...entry };
  if (trace === "Scatter" && out.width == null) out.width = 0;
  if ((trace === "Scatter" || trace === "Line + markers") && !out.marker) out.marker = true;
  if (trace === "Step" && !out.step && !raw?.line) out.step = "post";
  return Object.keys(out).length > 0 ? out : null;
}

/** `spec` with the default trace laid over its `series_styles` (see the
 *  module header); `spec` itself for the Line trace or a request it skips. */
export function withDefaultTrace(
  spec: FigureSpec,
  trace: DefaultTrace | undefined,
  rawStyles: Record<number, SeriesStyle>,
): FigureSpec {
  const keys = spec.y_keys;
  if (!trace || trace === "Line" || spec.facets || spec.encoding || !keys?.length) return spec;
  const styles = spec.series_styles ?? [];
  return {
    ...spec,
    series_styles: keys.map((k, i) =>
      traced(styles[i] ?? null, typeof k === "number" ? rawStyles[k] : undefined, trace),
    ),
  };
}
