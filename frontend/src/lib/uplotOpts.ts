// Build uPlot options from live design tokens, so the plot restyles for free
// when theme/accent change. The plot canvas stays dark in both themes.

import type uPlot from "uplot";

import { FILLED_SHAPES, markerPaths } from "./markers";
import type { Measurement } from "./measure";
import type { FwhmResult } from "./peakwidth";
import type { PlotPayload } from "./plotdata";
import type { RegionStats } from "./regionStats";
import type { Annotation, AxisFormat, LineStyle, RefLine, SeriesStyle } from "./types";
import { annotationPlugin, axisBoxPlugin, errorBarsPlugin, refLinePlugin } from "./uplotOverlays";
import { fwhmPlugin, integratePlugin } from "./uplotRegionTools";
import {
  measurePlugin,
  panPlugin,
  readoutPlugin,
  statsPlugin,
  wheelZoomPlugin,
  type Readout,
} from "./uplotTools";

export type PlotTool =
  | "zoom"
  | "pan"
  | "cursor"
  | "region"
  | "measure"
  | "stats"
  | "integ"
  | "fwhm";

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

/** Is the x column sorted ascending? uPlot's x scale defaults to `sorted: 1`,
 *  meaning it derives the scale range from the *endpoints* (a binary-search
 *  optimization) instead of scanning. That assumption breaks for non-monotonic x
 *  — e.g. a magnetometry M-vs-H hysteresis loop sweeps field up then down, so the
 *  first/last points are both at +saturation and uPlot collapses the x-range to a
 *  sliver → a blank plot. Detect it so we can fall back to `Unsorted` (scan all
 *  points). Nulls are skipped (they don't break monotonicity). */
export function xIsAscending(xs: readonly (number | null)[]): boolean {
  let prev = -Infinity;
  for (const v of xs) {
    if (v == null) continue;
    if (v < prev) return false;
    prev = v;
  }
  return true;
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
  /** In `region` tool: called with the two data-x edges of a completed drag
   *  (unordered). Used by the baseline "Fit from region" rubber-band. */
  onRegionSelect?: (x0: number, x1: number) => void;
  /** In `measure` tool: called with the live Δx/Δy/slope while dragging the
   *  two-point ruler (null when the ruler is cleared). */
  onMeasure?: (m: Measurement | null) => void;
  /** In `stats` tool: called with the live per-series summary stats over the
   *  dragged x-band (null when the band is empty / zero-width). */
  onStats?: (s: RegionStats | null) => void;
  /** Committed integral region (drawn persistently until cleared / dataset change). */
  integral?: { xlo: number; xhi: number; area: number } | null;
  /** In `integ` tool: commit the trapezoidal area over a completed drag. */
  onIntegrate?: (r: { xlo: number; xhi: number; area: number }) => void;
  /** Committed peak/FWHM result (drawn persistently until cleared / dataset change). */
  fwhmResult?: FwhmResult | null;
  /** In `fwhm` tool: commit the peak + FWHM estimate over a completed drag. */
  onFwhm?: (r: FwhmResult) => void;
  /** Explicit axis ranges (null = uPlot autoscale). Fix the axis Origin-style. */
  xLim?: [number, number] | null;
  yLim?: [number, number] | null;
  /** Reference lines to draw at fixed X/Y values. */
  refLines?: RefLine[];
  /** Commit a dragged reference line's new value (zoom/cursor tools only — the
   *  pan/measure/region tools own the drag gesture, so dragging is disabled). */
  onRefLineMove?: (id: string, value: number) => void;
  /** Text annotations pinned at data coordinates. */
  annotations?: Annotation[];
  /** Per-display-series style overrides, aligned 1:1 with `payload.series`
   *  (undefined entries — e.g. overlays — keep the defaults). */
  seriesStyles?: (SeriesStyle | undefined)[];
  /** Per-display-series display-name overrides (legend rename), aligned 1:1 with
   *  `payload.series` (undefined entries keep the dataset's own label + unit). */
  seriesLabels?: (string | undefined)[];
  /** Error-bar magnitudes keyed by uPlot data-column index (1-based). Draws
   *  vertical y±e whiskers for the mapped plotted series. */
  errorBars?: Map<number, (number | null)[]>;
  /** Per-display-series visibility (aligned 1:1 with `payload.series`); `true`
   *  hides that series (interactive legend). Undefined = all visible. */
  hidden?: boolean[];
  /** Axis tick number formats (auto = uPlot default). yFmt also drives y2. */
  xFmt?: AxisFormat;
  yFmt?: AxisFormat;
  /** Draw grid lines (default true). */
  showGrid?: boolean;
  /** Base axis tick/label font size in px (publication template; default 11). */
  fontSize?: number;
  /** Default series stroke width when no per-series override (template; default 1.5). */
  baseLineWidth?: number;
  /** Default trace shape for series without an explicit per-series style
   *  (Preferences ▸ Plot ▸ Default trace): "Line" | "Line + markers" | "Scatter"
   *  | "Step". Per-series overrides still win. */
  defaultTrace?: string;
  /** Enable wheel-to-zoom over the plot (Preferences ▸ Interaction ▸ Mouse wheel). */
  wheelZoom?: boolean;
  /** Stepped path builder (uPlot.paths.stepped) used for the "Step" default trace.
   *  Supplied by the caller so this module stays free of the uPlot *runtime*
   *  (a value import would pull uPlot's matchMedia init into headless tests). */
  steppedPaths?: uPlot.Series.PathBuilder;
  /** Draw a full rectangular frame around the plot area (publication "box"). */
  axisBox?: boolean;
  /** Chart title rendered above the plot (blank/undefined = none). */
  title?: string;
  /** Override the x-axis label (blank/undefined = derive from the data). */
  xAxisLabel?: string;
  /** Override the primary y-axis label; when set it shows even with >1 series
   *  (blank/undefined = the solo-series auto label). */
  yAxisLabel?: string;
}

export function buildOpts(payload: PlotPayload, args: BuildOptsArgs): uPlot.Options {
  const { width, height, yLog, xLog, tool, onReadout, xLim, yLim, refLines, seriesStyles } = args;
  const { xFmt, yFmt, annotations, showGrid, onRegionSelect } = args;
  const axisColor = cssVar("--text-dim") || "#aaa";
  const gridColor = cssVar("--grid-line") || "#333";
  const accentColor = cssVar("--accent") || "#8b5cf6";
  const accentSoftColor = cssVar("--accent-soft") || "rgba(139,92,246,0.18)";
  const captureSoftColor = cssVar("--capture-soft") || "rgba(200,160,80,0.16)";
  const font = `${args.fontSize ?? 11}px ${cssVar("--font-mono") || "monospace"}`;
  // X-axis label: an explicit override wins, else "name (unit)" from the data.
  const xLabel =
    args.xAxisLabel?.trim() ||
    (payload.xUnit ? `${payload.xLabel} (${payload.xUnit})` : payload.xLabel);
  // Resolved display label per series: an explicit rename wins, else "label (unit)".
  const labels = payload.series.map((s, i) =>
    args.seriesLabels?.[i] ?? (s.unit ? `${s.label} (${s.unit})` : s.label),
  );
  // Label each Y axis only when it carries a single series (else the legend names
  // them); a non-blank override on the primary axis always wins and forces a label.
  const soloLabel = (which: number): string | undefined => {
    if (which === 0 && args.yAxisLabel?.trim()) return args.yAxisLabel.trim();
    const idxs = payload.series.map((_, i) => i).filter((i) => (payload.series[i].axis ?? 0) === which);
    return idxs.length === 1 ? labels[idxs[0]] : undefined;
  };
  const hasY2 = payload.series.some((s) => (s.axis ?? 0) === 1);

  const axis = {
    stroke: axisColor,
    font,
    grid: showGrid === false ? { show: false } : { stroke: gridColor, width: 1 },
    ticks: { stroke: gridColor, width: 1 },
  };

  const plugins: uPlot.Plugin[] = [];
  if (tool === "pan") plugins.push(panPlugin());
  if (tool === "cursor") plugins.push(readoutPlugin(onReadout));
  if (tool === "measure" && args.onMeasure) {
    plugins.push(measurePlugin(args.onMeasure, cssVar("--accent") || "#8b5cf6"));
  }
  if (tool === "stats" && args.onStats) {
    plugins.push(statsPlugin(args.onStats, accentColor));
  }
  // Integrate / FWHM: when the tool is active, the plugin owns the drag AND draws
  // the committed result; otherwise a draw-only instance keeps a prior result
  // shaded across tool switches (it clears only on dataset change / chip clear).
  if (tool === "integ") {
    plugins.push(
      integratePlugin(args.integral ?? null, accentColor, accentSoftColor, {
        onIntegrate: args.onIntegrate,
        interactive: true,
      }),
    );
  } else if (args.integral) {
    plugins.push(integratePlugin(args.integral, accentColor, accentSoftColor));
  }
  if (tool === "fwhm") {
    plugins.push(
      fwhmPlugin(args.fwhmResult ?? null, accentColor, captureSoftColor, {
        onFwhm: args.onFwhm,
        interactive: true,
      }),
    );
  } else if (args.fwhmResult) {
    plugins.push(fwhmPlugin(args.fwhmResult, accentColor, captureSoftColor));
  }
  if (refLines && refLines.length > 0) {
    // Dragging only in the non-gesture tools (zoom/cursor); pan/measure/region
    // own the pointer-drag, so reference lines stay static there.
    plugins.push(
      refLinePlugin(refLines, cssVar("--text-dim") || "#888", {
        onMove: args.onRefLineMove,
        interactive: tool === "zoom" || tool === "cursor",
      }),
    );
  }
  if (annotations && annotations.length > 0) {
    plugins.push(annotationPlugin(annotations, cssVar("--text") || "#ddd", font));
  }
  if (args.errorBars && args.errorBars.size > 0) {
    plugins.push(errorBarsPlugin(args.errorBars, cssVar("--text-dim") || "#888"));
  }
  if (args.axisBox) {
    plugins.push(axisBoxPlugin(cssVar("--text-dim") || "#888"));
  }
  // Wheel-to-zoom is independent of the active tool (it's a navigation aid, not a
  // drag gesture), so it composes with any tool when the pref is on.
  if (args.wheelZoom) {
    plugins.push(wheelZoomPlugin());
  }

  // A static [min,max] tuple fixes the scale (Origin-style); omit it to autoscale.
  // time:false is CRITICAL — uPlot defaults the x scale to time mode, which
  // formats scientific x (Qz, 2θ, field) as dates ("12/31/69", ":00.040") and
  // renders blank for negative x (magnetometry field sweeps). These are physics
  // axes, never timestamps.
  const scales: uPlot.Scales = {
    x: { time: false, distr: xLog ? 3 : 1, ...(xLim ? { range: xLim } : {}) },
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
    ...(args.title?.trim() ? { title: args.title.trim() } : {}),
    // Box-zoom only in zoom mode; region drags an x-band without rescaling
    // (setScale:false), so setSelect can read it back; pan/cursor disable drag.
    cursor: {
      drag:
        tool === "region"
          ? { x: true, y: false, setScale: false, uni: 1 }
          : { x: tool === "zoom", y: tool === "zoom", uni: 1 },
    },
    // Region rubber-band: on drag end, hand the two data-x edges to the caller.
    // posToVal does the pixel->data mapping (linear or log x); regionSelect
    // orders/clamps. Guard width>0 so a click (zero-width select) is ignored.
    hooks: {
      setSelect: [
        (u: uPlot): void => {
          if (tool !== "region" || !onRegionSelect) return;
          const w = u.select.width;
          if (w <= 0) return;
          onRegionSelect(u.posToVal(u.select.left, "x"), u.posToVal(u.select.left + w, "x"));
        },
      ],
    },
    plugins,
    legend: { show: false },
    scales,
    axes,
    series: [
      // x series: declare its sort order so uPlot autoscales correctly. Ascending
      // (the common case: temperature/2θ/time) keeps the fast endpoint path;
      // non-monotonic x (hysteresis loops, swept-back scans) must scan all points.
      { sorted: xIsAscending(payload.data[0] as (number | null)[]) ? 1 : 0 },
      ...payload.series.map((s, i) => {
        const style = seriesStyles?.[i];
        const stroke = seriesColor(i, style);
        const label = labels[i];
        const scale = (s.axis ?? 0) === 1 ? "y2" : "y";
        const show = !args.hidden?.[i]; // interactive legend visibility
        // Peak markers: points only, no connecting line.
        if (s.kind === "points") {
          return { label, scale, stroke, fill: stroke, width: 0, points: { show: true, size: 8 }, show };
        }
        // Default trace shape (Preferences) when the series has no explicit style:
        // Scatter = markers, no line; Line + markers = both; Step = stepped line.
        const trace = args.defaultTrace ?? "Line";
        const scatter = trace === "Scatter";
        const width = style?.width ?? (scatter ? 0 : (args.baseLineWidth ?? 1.5));
        const dash = style?.line ? DASH[style.line] : undefined;
        // Optional markers. Default is a filled circle (uPlot built-in); other
        // glyphs supply a custom paths builder. Open glyphs (+/✕/✳) stroke only;
        // closed glyphs fill with the series colour.
        let points: uPlot.Series.Points = { show: false };
        if (style?.marker) {
          const size = style.markerSize ?? 5;
          const shape = style.markerShape ?? "circle";
          const paths = markerPaths(shape, size);
          points = paths
            ? { show: true, size, paths, stroke, ...(FILLED_SHAPES.has(shape) ? { fill: stroke } : {}) }
            : { show: true, size };
        } else if (scatter || trace === "Line + markers") {
          points = { show: true, size: 5 };
        }
        const def: uPlot.Series = { label, scale, stroke, width, dash, points, show };
        // Stepped trace: apply the caller-supplied step-after path builder (there's
        // no per-series line-shape override, so it's a global default).
        if (trace === "Step" && !style?.line && args.steppedPaths) {
          def.paths = args.steppedPaths;
        }
        return def;
      }),
    ],
  };
}
