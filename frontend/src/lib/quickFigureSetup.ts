// The Quick Figure Builder's "Right -- concise setup" panel model (plans/
// LIBRARY_WORKBOOK_UX_PLAN.md, Quick Figure Builder concept): colour preset,
// lines/markers, axes, legend, and error-bar settings, on top of the plot style
// the builder already had. LAZY (only the builder imports it): what reaches
// the canonical create path is its MATERIALIZED form, a `QuickFigureLook`
// (lib/quickFigureCommit.ts) made of existing PlotView fields plus per-series
// `SeriesStyle`s -- no new figure vocabulary, and the eager bundle only ever
// carries the tiny merge.
//
// An untouched setup materializes to a no-op look (default axes/legend, no
// series overrides, error bars on), so a figure created without opening the
// panel is byte-for-byte what the builder made before it existed.

import type { ErrorSpan } from "./errorbars";
import { PALETTES } from "./palettes";
import type { SpecRender } from "./plotspec";
import type { LegendPos } from "./plotview";
import type { QuickFigureLook } from "./quickFigureCommit";
import type { QuickPlotStyle } from "./quickFigurePreview";
import type { LineStyle, MarkerShape, SeriesStyle } from "./types";

export type QuickAxisScale = "linear" | "log";

export interface QuickFigureSetup {
  /** A `lib/palettes.ts` preset; "default" keeps the theme's own series cycle. */
  palette: string;
  lineWidth: number;
  lineStyle: LineStyle;
  markerShape: MarkerShape;
  markerSize: number;
  xScale: QuickAxisScale;
  yScale: QuickAxisScale;
  showGrid: boolean;
  showLegend: boolean;
  legendPos: LegendPos;
  /** Draw the mapping's error bindings; off creates the figure without them. */
  errorBars: boolean;
}

/** Matches `defaultPlotView()` and the render's SeriesStyle fallbacks (1.5 px,
 *  solid, circle, 5 px) -- the no-op look. */
export const DEFAULT_QUICK_FIGURE_SETUP: QuickFigureSetup = {
  palette: "default",
  lineWidth: 1.5,
  lineStyle: "solid",
  markerShape: "circle",
  markerSize: 5,
  xScale: "linear",
  yScale: "linear",
  showGrid: true,
  showLegend: true,
  legendPos: "ne",
  errorBars: true,
};

export const LINE_WIDTHS = [0.75, 1, 1.5, 2, 3];
export const MARKER_SIZES = [3, 5, 7, 9];
export const LINE_STYLES: readonly LineStyle[] = ["solid", "dashed", "dotted"];
export const MARKER_SHAPES: readonly MarkerShape[] = [
  "circle", "square", "triangle", "downtriangle", "diamond", "plus", "cross", "star",
];
export const LEGEND_CORNERS: readonly { value: LegendPos; label: string }[] = [
  { value: "ne", label: "Top right" },
  { value: "nw", label: "Top left" },
  { value: "se", label: "Bottom right" },
  { value: "sw", label: "Bottom left" },
];

/** Materialize the panel into the look the create path merges. Series styles
 *  cycle by plotted position: a palette gives one entry per colour, otherwise
 *  one shared entry (or none when nothing differs from the defaults). A
 *  GROUPED figure keeps the theme cycle -- its per-level series all share one
 *  channel style, so a per-channel colour would paint every level alike. */
export function quickFigureLook(setup: QuickFigureSetup, style: QuickPlotStyle, grouped: boolean): QuickFigureLook {
  const d = DEFAULT_QUICK_FIGURE_SETUP;
  const shared: SeriesStyle = {};
  if (style !== "scatter") {
    if (setup.lineWidth !== d.lineWidth) shared.width = setup.lineWidth;
    if (setup.lineStyle !== d.lineStyle) shared.line = setup.lineStyle;
  }
  if (style !== "line" && (setup.markerShape !== d.markerShape || setup.markerSize !== d.markerSize)) {
    // `markerShape`/`markerSize` are read only when `marker` is set (lib/markers.ts).
    shared.marker = true;
    if (setup.markerShape !== d.markerShape) shared.markerShape = setup.markerShape;
    if (setup.markerSize !== d.markerSize) shared.markerSize = setup.markerSize;
  }
  const colors = grouped ? null : (PALETTES.find((p) => p.value === setup.palette)?.colors ?? null);
  const series = colors ? colors.map((color) => ({ ...shared, color })) : Object.keys(shared).length > 0 ? [shared] : [];
  const { xScale, yScale, showGrid, showLegend, legendPos, errorBars } = setup;
  return { xScale, yScale, showGrid, showLegend, legendPos, series, errorBars };
}

const log10OrNull = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(v) && v > 0 ? Math.log10(v) : null;

/** A span's magnitudes re-expressed on a log axis around each point's value. */
function logSpan(span: ErrorSpan, values: readonly (number | null)[]): ErrorSpan {
  const at = (i: number, delta: number | null, sign: 1 | -1): number | null => {
    const v = values[i];
    if (delta == null || v == null || !(v > 0)) return null;
    const moved = log10OrNull(v + sign * delta);
    return moved == null ? null : Math.abs(moved - Math.log10(v));
  };
  return { ...span, plus: span.plus.map((p, i) => at(i, p, 1)), minus: span.minus.map((m, i) => at(i, m, -1)) };
}

/** The preview as the look will render it: log axes applied to the data (and
 *  error whiskers), error bars dropped when off. Anything but an xy render
 *  passes through. The canvas has no tick labels, so a log axis previews as
 *  the shape of the curve, which is what the choice changes. */
export function previewWithLook(render: SpecRender, look: QuickFigureLook): SpecRender {
  if (render.kind !== "xy") return render;
  const cols = render.payload.data as (number | null)[][];
  const logX = look.xScale === "log";
  const logY = look.yScale === "log";
  const data = cols.map((col, i) => ((i === 0 ? logX : logY) ? col.map(log10OrNull) : col));
  let errorSpans: Map<number, ErrorSpan[]> | undefined;
  if (look.errorBars && render.errorSpans) {
    errorSpans = new Map();
    for (const [key, spans] of render.errorSpans) {
      errorSpans.set(key, spans.map((s) => ((s.axis === "x" ? logX : logY) ? logSpan(s, cols[s.axis === "x" ? 0 : key]) : s)));
    }
  }
  const out = { ...render, payload: { ...render.payload, data: data as typeof render.payload.data } };
  if (errorSpans && errorSpans.size > 0) out.errorSpans = errorSpans;
  else delete out.errorSpans;
  return out;
}

/** One sentence naming the points a log axis cannot draw (X or Y ≤ 0), or
 *  null when it hides none. Counted on the UNtransformed render, one per drawn
 *  point: on X when its X is out, else on Y, so nothing is counted twice. */
export function logDropNotice(render: SpecRender, look: QuickFigureLook): string | null {
  const logX = look.xScale === "log";
  const logY = look.yScale === "log";
  if (render.kind !== "xy" || (!logX && !logY)) return null;
  const [xs, ...ys] = render.payload.data as (number | null)[][];
  let onX = 0;
  let onY = 0;
  for (const col of ys) {
    col.forEach((y, r) => {
      const x = xs[r];
      if (y == null || x == null || !Number.isFinite(y) || !Number.isFinite(x)) return;
      if (logX && x <= 0) onX += 1;
      else if (logY && y <= 0) onY += 1;
    });
  }
  const pts = (n: number): string => `${n} point${n === 1 ? "" : "s"}`;
  if (onX > 0 && onY > 0) return `The log axes hide ${pts(onX + onY)}: ${onX} with X ≤ 0 and ${onY} with Y ≤ 0.`;
  if (onX > 0) return `The log X axis hides ${pts(onX)} with X ≤ 0.`;
  if (onY > 0) return `The log Y axis hides ${pts(onY)} with Y ≤ 0.`;
  return null;
}

/** The per-series styles the preview canvas paints (series `i` of the payload). */
export function lookSeriesStyles(look: QuickFigureLook, count: number): SeriesStyle[] | undefined {
  const n = look.series.length;
  return n === 0 ? undefined : Array.from({ length: count }, (_, i) => look.series[i % n]);
}
