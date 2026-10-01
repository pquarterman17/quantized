// The canvas' line width on the export wire. A series with no explicit width
// draws at `plotTemplates.canvasLineWidth` (the plot template's width, or the
// Preferences default under the Screen template: 1.5 px out of the box), but
// a request that named no width left matplotlib on the style preset's
// `line_width` (1.2 pt on "default", 1.0 on "nature", 3.0 on "poster"). This
// names the canvas width on every such series, read as points: the rule an
// explicit width and a sizeless marker (`exportStyles.toWireSeriesStyles`
// rule 3) already follow. The presets' calibrated `line_width` values
// (ported from quantized_matlab's +styles/template.m) stay the backend default
// for a request that names no width, i.e. an API or CLI caller.
// Shared fixture: `tests/fixtures/wire/default_trace.json` (`line_width_rule`).
//
// Applied beside `exportDefaultTrace` (after it, so a Scatter trace's width 0
// is already set) by the same builders: `figureSpec.buildFigureSpecForView`
// and `figurebuilder/legacyFigure`. Left alone: an explicit width (0 included),
// `line: "none"`, a colour-mapped (`color_by`) entry, a GRADIENT encoding,
// whose series are colour-mapped scatters on both sides, and a document whose
// publication styles are explicitly `null` (matplotlib's own styling).
// The paths whose canvases size lines separately apply the same rule with
// their canvas' width (`tests/fixtures/wire/line_width_paths.json`): a spatial
// page (`spatialPageExport`, `canvasLineWidth` like the Stage), the Graph
// Builder's encoded export (`plotEncodingExport`, the preview's fixed width) and
// the polar figure (`polarFigureSpec`, the polar canvas' fixed width).

import type { FigureSpec } from "./api/figures";
import type { ExportSeriesStyle } from "./publicationStyles";

function widened(entry: ExportSeriesStyle | null | undefined, width: number): ExportSeriesStyle | null {
  if (entry?.width != null || entry?.line === "none" || entry?.color_by != null) return entry ?? null;
  return { ...entry, width };
}

/** `styles` (aligned 1:1 with `keys`) with `width` on every entry that names
 *  none; a missing entry is unstyled. `styles` itself when `width` is absent. */
export function lineWidthSeriesStyles(
  styles: (ExportSeriesStyle | null)[] | null | undefined,
  keys: readonly unknown[],
  width: number | undefined,
): (ExportSeriesStyle | null)[] | null | undefined {
  if (width == null || keys.length === 0) return styles;
  return keys.map((_k, i) => widened(styles?.[i], width));
}

/** `spec` with the canvas `width` on its `series_styles` and, for a facet grid,
 *  every panel series' `style` too (see the module header). The top-level list
 *  is widened on a facet grid as well, so faceting stays purely additive. */
export function withCanvasLineWidth(spec: FigureSpec, width: number | undefined): FigureSpec {
  if (width == null || spec.encoding?.gradient_col != null) return spec;
  const keys = spec.y_keys;
  const flat = keys?.length
    ? { ...spec, series_styles: lineWidthSeriesStyles(spec.series_styles, keys, width) ?? undefined }
    : spec;
  if (!spec.facets) return flat;
  return {
    ...flat,
    facets: spec.facets.map((panel) => ({
      ...panel,
      series: panel.series.map((s) => ({ ...s, style: widened(s.style, width) })),
    })),
  };
}
