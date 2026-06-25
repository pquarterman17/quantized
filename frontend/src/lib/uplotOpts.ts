// Build uPlot options from live design tokens, so the plot restyles for free
// when theme/accent change. The plot canvas stays dark in both themes.

import type uPlot from "uplot";

import type { PlotPayload } from "./plotdata";
import type { AxisFormat, LineStyle, RefLine, SeriesStyle } from "./types";
import { panPlugin, readoutPlugin, refLinePlugin, type Readout } from "./uplotPlugins";

export type PlotTool = "zoom" | "pan" | "cursor";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const SERIES_VARS = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
];

/** Dash patterns (canvas setLineDash arrays) per line style; solid = no dash. */
const DASH: Record<LineStyle, number[] | undefined> = {
  solid: undefined,
  dashed: [8, 4],
  dotted: [2, 4],
};

/** A uPlot axis `values` callback: maps tick split values to label strings. */
type TickValues = (
  self: uPlot,
  splits: number[],
  axisIdx: number,
  foundSpace: number,
  foundIncr: number,
) => (string | number | null)[];

/** Build a uPlot axis `values` formatter for a tick mode; `auto` returns
 *  undefined so uPlot keeps its own (locale-aware, span-adaptive) labels. */
export function tickFormatter(fmt?: AxisFormat): TickValues | undefined {
  if (!fmt || fmt.mode === "auto") return undefined;
  const d = Math.max(0, Math.min(20, Math.round(fmt.digits)));
  const fn = fmt.mode === "sci" ? (v: number) => v.toExponential(d) : (v: number) => v.toFixed(d);
  return (_u, splits) => splits.map((v) => (v == null ? null : fn(v)));
}

/** Effective stroke for display-series `i`: an explicit override (token name or
 *  literal hex) wins, else the palette color by position. A `"--token"` color is
 *  resolved through `cssVar` so it stays re-themeable; a literal passes through. */
export function seriesColor(i: number, style?: SeriesStyle): string {
  const c = style?.color;
  if (c) return c.startsWith("--") ? cssVar(c) || c : c;
  return cssVar(SERIES_VARS[i % SERIES_VARS.length]) || "#8b5cf6";
}

export interface BuildOptsArgs {
  width: number;
  height: number;
  yLog: boolean;
  xLog: boolean;
  tool: PlotTool;
  onReadout: (r: Readout | null) => void;
  /** Explicit axis ranges (null = uPlot autoscale). Fix the axis Origin-style. */
  xLim?: [number, number] | null;
  yLim?: [number, number] | null;
  /** Reference lines to draw at fixed X/Y values. */
  refLines?: RefLine[];
  /** Per-display-series style overrides, aligned 1:1 with `payload.series`
   *  (undefined entries — e.g. overlays — keep the defaults). */
  seriesStyles?: (SeriesStyle | undefined)[];
  /** Axis tick number formats (auto = uPlot default). yFmt also drives y2. */
  xFmt?: AxisFormat;
  yFmt?: AxisFormat;
}

export function buildOpts(payload: PlotPayload, args: BuildOptsArgs): uPlot.Options {
  const { width, height, yLog, xLog, tool, onReadout, xLim, yLim, refLines, seriesStyles } = args;
  const { xFmt, yFmt } = args;
  const axisColor = cssVar("--text-dim") || "#aaa";
  const gridColor = cssVar("--grid-line") || "#333";
  const font = `11px ${cssVar("--font-mono") || "monospace"}`;
  const xLabel = payload.xUnit ? `${payload.xLabel} (${payload.xUnit})` : payload.xLabel;
  const seriesLabel = (s: { label: string; unit: string }): string =>
    s.unit ? `${s.label} (${s.unit})` : s.label;
  // Label each Y axis only when it carries a single series (else the legend names them).
  const soloLabel = (which: number): string | undefined => {
    const on = payload.series.filter((s) => (s.axis ?? 0) === which);
    return on.length === 1 ? seriesLabel(on[0]) : undefined;
  };
  const hasY2 = payload.series.some((s) => (s.axis ?? 0) === 1);

  const axis = {
    stroke: axisColor,
    font,
    grid: { stroke: gridColor, width: 1 },
    ticks: { stroke: gridColor, width: 1 },
  };

  const plugins: uPlot.Plugin[] = [];
  if (tool === "pan") plugins.push(panPlugin());
  if (tool === "cursor") plugins.push(readoutPlugin(onReadout));
  if (refLines && refLines.length > 0) {
    plugins.push(refLinePlugin(refLines, cssVar("--text-dim") || "#888"));
  }

  // A static [min,max] tuple fixes the scale (Origin-style); omit it to autoscale.
  const scales: uPlot.Scales = {
    x: { distr: xLog ? 3 : 1, ...(xLim ? { range: xLim } : {}) },
    y: { distr: yLog ? 3 : 1, ...(yLim ? { range: yLim } : {}) },
  };
  const xValues = tickFormatter(xFmt);
  const yValues = tickFormatter(yFmt);
  const axes: uPlot.Axis[] = [
    { ...axis, label: xLabel, ...(xValues ? { values: xValues } : {}) },
    { ...axis, size: 60, label: soloLabel(0), ...(yValues ? { values: yValues } : {}) },
  ];
  if (hasY2) {
    scales.y2 = { distr: yLog ? 3 : 1 };
    // Secondary axis on the right; hide its grid so the two grids don't overlap.
    axes.push({
      ...axis,
      scale: "y2",
      side: 1,
      size: 60,
      label: soloLabel(1),
      grid: { show: false },
      ...(yValues ? { values: yValues } : {}),
    });
  }

  return {
    width,
    height,
    // Box-zoom only in zoom mode; pan/cursor disable drag-zoom.
    cursor: { drag: { x: tool === "zoom", y: tool === "zoom", uni: 1 } },
    plugins,
    legend: { show: false },
    scales,
    axes,
    series: [
      {},
      ...payload.series.map((s, i) => {
        const style = seriesStyles?.[i];
        const stroke = seriesColor(i, style);
        const label = seriesLabel(s);
        const scale = (s.axis ?? 0) === 1 ? "y2" : "y";
        // Peak markers: points only, no connecting line.
        if (s.kind === "points") {
          return { label, scale, stroke, fill: stroke, width: 0, points: { show: true, size: 8 } };
        }
        const width = style?.width ?? 1.5;
        const dash = style?.line ? DASH[style.line] : undefined;
        return { label, scale, stroke, width, dash, points: { show: false } };
      }),
    ],
  };
}
