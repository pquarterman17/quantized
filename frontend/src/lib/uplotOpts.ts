// Build uPlot options from live design tokens, so the plot restyles for free
// when theme/accent change. The plot canvas stays dark in both themes.

import type uPlot from "uplot";

import { FILLED_SHAPES, markerPaths } from "./markers";
import type { Measurement } from "./measure";
import type { FwhmResult } from "./peakwidth";
import type { PlotPayload } from "./plotdata";
import type { GadgetMode } from "./quickfit";
import type { RegionStats } from "./regionStats";
import type { Annotation, AxisFormat, LineStyle, RefLine, SeriesStyle } from "./types";
import { annotationPlugin, axisBoxPlugin, errorBarsPlugin, refLinePlugin } from "./uplotOverlays";
import { gadgetCursorsPlugin, quickFitPlugin } from "./uplotGadgets";
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
  | "select"
  | "measure"
  | "stats"
  | "integ"
  | "fwhm"
  | "qfit";

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
  /** #50 plot-brush: drag-end x-band edges for the "select" tool. */
  onRangeSelect?: (x0: number, x1: number) => void;
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
  /** Quick-fit gadget (#33) ROI band, in data coords (null = none committed
   *  yet). Persists across draws while the `qfit` tool is active; the tool
   *  clears it (and the fit overlay/chip) on tool switch — see PlotStage. */
  qfitRoi?: [number, number] | null;
  /** In `qfit` tool: fires on every create/move/resize of the ROI band (data
   *  coords; null = a sub-6px drag cleared it). The caller debounces the
   *  actual re-fit request — see the store's `setQfitRoi`. */
  onRoiChange?: (roi: [number, number] | null) => void;
  /** ROI gadget family (#34): which gadget is selected on the chip. When
   *  `"cursors"`, the `qfit` tool swaps its plugin from the ROI band
   *  (quickFitPlugin) to the paired-cursors drag (gadgetCursorsPlugin) — the
   *  rest of the modes (fit/integrate/stats/differentiate/fft) all share the
   *  same ROI band, only what the store computes from it differs. */
  gadgetMode?: GadgetMode;
  /** Cursors-mode positions, in data coords (null = none placed yet). */
  gadgetCursors?: [number, number] | null;
  /** In `qfit` tool + cursors mode: fires on every create/move of a cursor. */
  onCursorsChange?: (c: [number, number] | null) => void;
  /** Explicit axis ranges (null = uPlot autoscale). Fix the axis Origin-style. */
  xLim?: [number, number] | null;
  yLim?: [number, number] | null;
  /** Secondary (right) Y axis: explicit range + log scale. An applied Origin
   *  double-Y figure carries layer 2's own axis state here; null/undefined =
   *  autoscale / inherit yLog (the pre-2026-07-06 behaviour). */
  y2Lim?: [number, number] | null;
  y2Log?: boolean | null;
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
  /** Linear/points path builders (uPlot.paths.linear() / .points()), supplied by
   *  the caller for the same runtime-free reason as `steppedPaths`. Used when x
   *  is non-monotonic (hysteresis loops, swept-back scans): uPlot derives its
   *  drawn index window from a binary search over x that assumes ascending
   *  order, so a loop collapses to a sliver — one visible point. These builders
   *  get wrapped to ignore the window and draw every point in acquisition
   *  order, which renders the loop the way the instrument swept it. */
  linearPaths?: uPlot.Series.PathBuilder;
  pointsPaths?: uPlot.Series.Points.PathBuilder;
  /** Draw a full rectangular frame around the plot area (publication "box"). */
  axisBox?: boolean;
  /** Chart title rendered above the plot (blank/undefined = none). */
  title?: string;
  /** Override the x-axis label (blank/undefined = derive from the data). */
  xAxisLabel?: string;
  /** Override the primary y-axis label; when set it shows even with >1 series
   *  (blank/undefined = the solo-series auto label). */
  yAxisLabel?: string;
  /** Override the secondary y-axis label (Origin double-Y apply carries layer
   *  2's decoded title here); same blank/undefined semantics as yAxisLabel. */
  y2AxisLabel?: string;
}

/** Full-scan [min, max] of the finite values across every visible series on one
 *  scale — the manual counterpart of uPlot's auto-range for non-monotonic x,
 *  where uPlot's own scan window (derived from a binary search over x) is
 *  meaningless. Log scales consider positive values only. Returns null when
 *  nothing qualifies (leave uPlot's default behaviour alone). */
function fullYExtents(
  payload: PlotPayload,
  hidden: boolean[] | undefined,
  axis: 0 | 1,
  log: boolean,
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  payload.series.forEach((s, i) => {
    if ((s.axis ?? 0) !== axis || hidden?.[i]) return;
    for (const v of payload.data[i + 1] ?? []) {
      if (v == null || !Number.isFinite(v) || (log && v <= 0)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  });
  if (min > max) return null;
  if (log) return [min / 1.1, max * 1.1];
  const pad = (max - min || Math.abs(max) || 1) * 0.1; // mirror uPlot's soft pad
  return [min - pad, max + pad];
}

/** Full-scan [min, max] of the finite x values, lightly padded — the X
 *  counterpart of fullYExtents. For non-monotonic x (a hysteresis loop sweeps
 *  field up then down, so it starts and ends near the SAME saturation), uPlot's
 *  binary-search autorange collapses the axis to [first, last] — a sliver near
 *  one end. Scanning restores the true sweep width. Log considers positive x
 *  only. Null when nothing qualifies (leave uPlot's default alone). */
function fullXExtents(xs: readonly (number | null)[], log: boolean): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of xs) {
    if (v == null || !Number.isFinite(v) || (log && v <= 0)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return null;
  if (log) return [min / 1.1, max * 1.1];
  const pad = (max - min || Math.abs(max) || 1) * 0.02; // slim x margin, avoid edge clipping
  return [min - pad, max + pad];
}

export function buildOpts(payload: PlotPayload, args: BuildOptsArgs): uPlot.Options {
  const { width, height, yLog, xLog, tool, onReadout, xLim, yLim, refLines, seriesStyles } = args;
  const { xFmt, yFmt, annotations, showGrid, onRegionSelect } = args;
  const xAscending = xIsAscending(payload.data[0] as (number | null)[]);
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
    if (which === 1 && args.y2AxisLabel?.trim()) return args.y2AxisLabel.trim();
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
  // Gadget frame (#33 fit → #34 the rest): only draws/drags while its tool is
  // active (the gadget is cleared entirely on tool switch — see PlotStage —
  // so there is no draw-only "persists across tools" branch here). Cursors
  // mode swaps the ROI band for two independent draggable lines; every other
  // mode (fit/integrate/stats/differentiate/fft) shares the same band — only
  // what the store computes from it differs.
  if (tool === "qfit") {
    if (args.gadgetMode === "cursors") {
      plugins.push(
        gadgetCursorsPlugin(args.gadgetCursors ?? null, accentColor, {
          onCursorsChange: args.onCursorsChange,
          interactive: true,
        }),
      );
    } else {
      plugins.push(
        quickFitPlugin(args.qfitRoi ?? null, accentColor, accentSoftColor, {
          onRoiChange: args.onRoiChange,
          interactive: true,
        }),
      );
    }
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
  // Non-monotonic x also breaks uPlot's y auto-range (it scans the same
  // collapsed index window), so supply full-scan extents. A range *function*
  // is only consulted when no explicit scale is pending, so box/wheel zoom and
  // a fixed yLim still win; double-click reset re-ranges back to the extents.
  const y2LogEff = args.y2Log ?? yLog;
  const loopY = !xAscending && !yLim ? fullYExtents(payload, args.hidden, 0, yLog) : null;
  const loopY2 = !xAscending ? fullYExtents(payload, args.hidden, 1, y2LogEff) : null;
  // …and its x auto-range collapses to a sliver for the same reason — scan the
  // x column for the true sweep width (a range function, so zoom/xLim still win).
  const loopX = !xAscending && !xLim ? fullXExtents(payload.data[0] as (number | null)[], xLog) : null;
  const scales: uPlot.Scales = {
    x: {
      time: false,
      distr: xLog ? 3 : 1,
      ...(xLim ? { range: xLim } : loopX ? { range: () => loopX } : {}),
    },
    y: {
      distr: yLog ? 3 : 1,
      ...(yLim ? { range: yLim } : loopY ? { range: () => loopY } : {}),
    },
  };
  const xValues = tickFormatter(xFmt);
  const yValues = tickFormatter(yFmt);
  const axes: uPlot.Axis[] = [
    { ...axis, label: xLabel, ...(xValues ? { values: xValues } : {}) },
    { ...axis, size: 60, label: soloLabel(0), ...(yValues ? { values: yValues } : {}) },
  ];
  if (hasY2) {
    const y2Lim = args.y2Lim ?? null;
    scales.y2 = {
      distr: y2LogEff ? 3 : 1,
      ...(y2Lim ? { range: y2Lim } : loopY2 ? { range: () => loopY2 } : {}),
    };
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
        tool === "region" || tool === "select"
          ? { x: true, y: false, setScale: false, uni: 1 }
          : { x: tool === "zoom", y: tool === "zoom", uni: 1 },
    },
    // Region / select rubber-band: on drag end, hand the two data-x edges to the
    // matching caller. posToVal does the pixel->data mapping (linear or log x);
    // the caller orders/clamps. Guard width>0 so a click (zero-width) is ignored.
    hooks: {
      setSelect: [
        (u: uPlot): void => {
          const cb = tool === "region" ? onRegionSelect : tool === "select" ? args.onRangeSelect : null;
          if (!cb) return;
          const w = u.select.width;
          if (w <= 0) return;
          cb(u.posToVal(u.select.left, "x"), u.posToVal(u.select.left + w, "x"));
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
      { sorted: xAscending ? 1 : 0 },
      ...payload.series.map((s, i) => {
        const style = seriesStyles?.[i];
        const stroke = seriesColor(i, style);
        const label = labels[i];
        const scale = (s.axis ?? 0) === 1 ? "y2" : "y";
        const show = !args.hidden?.[i]; // interactive legend visibility
        // Selected companion (#50 brush): accent, filled larger markers, no line.
        if (s.selected) {
          return { label, scale, stroke: accentColor, fill: accentColor, width: 0, points: loopPoints({ show: true, size: 7 }), show };
        }
        // Muted "excluded" companion (grey mode): faint hollow markers, no line.
        if (s.muted) {
          const grey = cssVar("--text-faint") || cssVar("--text-dim") || "#888";
          return { label, scale, stroke: grey, width: 0, points: loopPoints({ show: true, size: 5 }), show };
        }
        // Peak markers: points only, no connecting line.
        if (s.kind === "points") {
          return { label, scale, stroke, fill: stroke, width: 0, points: loopPoints({ show: true, size: 8 }), show };
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
        const def: uPlot.Series = { label, scale, stroke, width, dash, points: loopPoints(points), show };
        // Stepped trace: apply the caller-supplied step-after path builder (there's
        // no per-series line-shape override, so it's a global default).
        if (trace === "Step" && !style?.line && args.steppedPaths) {
          def.paths = xAscending ? args.steppedPaths : fullLine(args.steppedPaths);
        } else if (!xAscending && width > 0 && args.linearPaths) {
          // Loop rendering: draw the line over every point in acquisition order.
          def.paths = fullLine(args.linearPaths);
        }
        return def;
      }),
    ],
  };
}
