// Graph FORMAT -- the style-only half of a plot, the way Origin's "Copy
// Format" / graph templates mean it (figures-audit B2). It carries how a
// graph LOOKS -- axis scales, tick formats, grid/frame/legend chrome, the
// plot template, axis-title fonts, and one series style per plotted
// POSITION -- and never what it shows: no channel bindings, no limits, no
// titles, no data-anchored decorations. That is what lets it travel to any
// other graph, of any dataset, plain CSV included: series styles land on the
// target's first, second, ... plotted series in order.
//
// Pure. Callers (store-side commands, the Publication preview's template
// hook) supply the plotted channel order (`effectiveChannels`) and decide how
// to commit the returned patch.

import { isAxisScale } from "./plotviewAxis";
import type { LegendPos, PlotView } from "./plotview";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { SeriesStyle } from "./seriesStyleTypes";
import type { AxisFormat, AxisScale } from "./types";

export const GRAPH_FORMAT_VERSION = 1;

/** The view fields a format copies verbatim (everything but the per-series
 *  styles, which are re-keyed by position). */
export type GraphFormatFields = Pick<
  PlotView,
  | "xScale" | "yScale" | "y2Scale" | "xReversed"
  | "xFmt" | "yFmt" | "y2Fmt"
  | "showGrid" | "showAxisBox" | "showLegend" | "legendPos" | "legendStatic"
  | "plotTemplate" | "axisLabelStyles"
>;

export interface GraphFormat extends GraphFormatFields {
  version: typeof GRAPH_FORMAT_VERSION;
  /** One style per plotted series POSITION (null = that position uses the
   *  automatic style). */
  series: (SeriesStyle | null)[];
}

/** Strip the fields of a series style that name a dataset CHANNEL
 *  (`colorBy`, a fill band's `vs`): a format is data-free, and a channel
 *  index from one dataset means nothing on another. */
function portableStyle(style: SeriesStyle | undefined): SeriesStyle | null {
  if (!style) return null;
  const { colorBy: _colorBy, colormap: _colormap, fill, ...rest } = style;
  void _colorBy;
  void _colormap;
  const out: SeriesStyle = { ...rest };
  if (fill === "under") out.fill = "under";
  return Object.keys(out).length > 0 ? out : null;
}

/** Capture the format of `view`, whose plotted series are `plotted` (in
 *  display order). */
export function captureGraphFormat(view: GraphFormatFields & Pick<PlotView, "seriesStyles">, plotted: readonly number[]): GraphFormat {
  return {
    version: GRAPH_FORMAT_VERSION,
    xScale: view.xScale,
    yScale: view.yScale,
    y2Scale: view.y2Scale,
    xReversed: view.xReversed,
    xFmt: { ...view.xFmt },
    yFmt: { ...view.yFmt },
    y2Fmt: view.y2Fmt ? { ...view.y2Fmt } : null,
    showGrid: view.showGrid,
    showAxisBox: view.showAxisBox,
    showLegend: view.showLegend,
    legendPos: view.legendPos,
    legendStatic: view.legendStatic,
    plotTemplate: view.plotTemplate,
    axisLabelStyles: structuredClone(view.axisLabelStyles),
    series: plotted.map((ch) => {
      const style = portableStyle(view.seriesStyles[ch]);
      return style ? structuredClone(style) : null;
    }),
  };
}

/** The view patch that applies `format` to a graph whose plotted series are
 *  `plotted`. Series styles REPLACE the target's styles for those channels
 *  (a format paste is a restyle, not a merge); channels past the format's
 *  last position keep their current style. Nothing the format does not carry
 *  (bindings, limits, titles, decorations) is touched. */
export function graphFormatPatch(
  format: GraphFormat,
  plotted: readonly number[],
  currentStyles: Readonly<Record<number, SeriesStyle>>,
): Partial<PlotView> {
  const seriesStyles: Record<number, SeriesStyle> = { ...currentStyles };
  plotted.forEach((ch, position) => {
    if (position >= format.series.length) return;
    const style = format.series[position];
    if (style) seriesStyles[ch] = structuredClone(style);
    else delete seriesStyles[ch];
  });
  return {
    xScale: format.xScale,
    yScale: format.yScale,
    y2Scale: format.y2Scale,
    xReversed: format.xReversed,
    xFmt: { ...format.xFmt },
    yFmt: { ...format.yFmt },
    y2Fmt: format.y2Fmt ? { ...format.y2Fmt } : null,
    showGrid: format.showGrid,
    showAxisBox: format.showAxisBox,
    showLegend: format.showLegend,
    legendPos: format.legendPos,
    legendStatic: format.legendStatic,
    plotTemplate: format.plotTemplate,
    axisLabelStyles: structuredClone(format.axisLabelStyles),
    seriesStyles,
  };
}

const LEGEND_POSITIONS: readonly LegendPos[] = ["auto", "ne", "nw", "se", "sw"];

function isFmt(v: unknown): v is AxisFormat {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.mode === "string" && typeof o.digits === "number" && Number.isFinite(o.digits);
}

/** Validate an untrusted (localStorage / imported) format; null when it is
 *  not recognizably one. Field-level fallbacks keep a partly damaged record
 *  useful rather than dropping it. */
export function sanitizeGraphFormat(v: unknown): GraphFormat | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== GRAPH_FORMAT_VERSION || !Array.isArray(o.series)) return null;
  const scale = (x: unknown): AxisScale => (isAxisScale(x) ? x : "linear");
  const bool = (x: unknown, d: boolean): boolean => (typeof x === "boolean" ? x : d);
  const fmt = (x: unknown): AxisFormat => (isFmt(x) ? { ...x } : { mode: "auto", digits: 2 });
  return {
    version: GRAPH_FORMAT_VERSION,
    xScale: scale(o.xScale),
    yScale: scale(o.yScale),
    y2Scale: isAxisScale(o.y2Scale) ? o.y2Scale : null,
    xReversed: bool(o.xReversed, false),
    xFmt: fmt(o.xFmt),
    yFmt: fmt(o.yFmt),
    y2Fmt: isFmt(o.y2Fmt) ? { ...o.y2Fmt } : null,
    showGrid: bool(o.showGrid, true),
    showAxisBox: bool(o.showAxisBox, true),
    showLegend: bool(o.showLegend, true),
    legendPos: LEGEND_POSITIONS.includes(o.legendPos as LegendPos) ? (o.legendPos as LegendPos) : "auto",
    legendStatic: bool(o.legendStatic, false),
    plotTemplate: typeof o.plotTemplate === "string" ? o.plotTemplate : "screen",
    axisLabelStyles: typeof o.axisLabelStyles === "object" && o.axisLabelStyles !== null
      ? (structuredClone(o.axisLabelStyles) as PlotView["axisLabelStyles"])
      : {},
    series: o.series.map((s) => (typeof s === "object" && s !== null ? portableStyle(s as SeriesStyle) : null)),
  };
}

/** The interactive series style a publication (export-wire) style stands for
 *  -- how a graph template saved in the Publication preview, which carries
 *  only export styles, restyles a Stage graph. */
export function seriesStyleFromExport(style: ExportSeriesStyle | null): SeriesStyle | null {
  if (!style) return null;
  const out: SeriesStyle = {};
  if (typeof style.color === "string" && style.colorDerived !== true) out.color = style.color;
  if (typeof style.width === "number") out.width = style.width;
  if (style.line === "none") out.width = 0;
  else if (style.line) out.line = style.line;
  if (typeof style.marker === "boolean") out.marker = style.marker;
  if (typeof style.marker_size === "number") out.markerSize = style.marker_size;
  if (typeof style.marker_shape === "string") out.markerShape = style.marker_shape as SeriesStyle["markerShape"];
  if (style.step) out.step = style.step;
  if (style.fill === "under") out.fill = "under";
  return Object.keys(out).length > 0 ? out : null;
}
