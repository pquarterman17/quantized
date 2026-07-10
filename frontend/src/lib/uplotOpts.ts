// Build uPlot options from live design tokens, so the plot restyles for free
// when theme/accent change. The plot canvas stays dark in both themes.

import type uPlot from "uplot";

import { resolveDrawColor } from "./contrastColor";
import { FILLED_SHAPES, markerPaths } from "./markers";
import type { Measurement } from "./measure";
import type { FwhmResult } from "./peakwidth";
import type { PlotBg } from "./plotview";
import type { PlotPayload } from "./plotdata";
import type { GadgetMode } from "./quickfit";
import type { RegionStats } from "./regionStats";
import { pow10 } from "./ticks";
import type { Annotation, AxisFormat, LineStyle, RefLine, SeriesStyle } from "./types";
import { annotationPlugin, axisBoxPlugin, errorBarsPlugin, refLinePlugin } from "./uplotOverlays";
import { gadgetCursorsPlugin, quickFitPlugin } from "./uplotGadgets";
import { peakMarkerEditPlugin, type PeakMarkerCandidate } from "./peakMarkerHit";
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

/** The concrete design-token values a plot window's EFFECTIVE background
 *  resolves to (item 18, owner request 2026-07-09): the canvas background
 *  colour (for the hosting DOM element's inline style — uPlot itself has no
 *  "background" option; it draws on a transparent canvas over whatever CSS
 *  supplies), the grid/ink colours `buildOpts` draws axes/overlays with, and
 *  whether that background reads as dark (feeds `resolveDrawColor`'s
 *  contrast math below). "theme" (default) reproduces today's behaviour —
 *  the plot canvas stays dark regardless of the app's global light/dark
 *  theme (see `styles/colors.css`'s `--axes-bg` doc) — until a window is
 *  explicitly pinned to "light" (Origin's white graph page) or "dark". The
 *  "dark"/"light" token pairs are MODE-scoped, not theme-scoped (same value
 *  regardless of the app's `[data-theme]` — see colors.css), so a window
 *  stays correctly readable even when its own override disagrees with the
 *  surrounding chrome's theme. The single resolution chokepoint: both
 *  `buildOpts` (canvas draw colours) and the window-chrome components
 *  (`PlotStage`/`PlotWindowFrame`, inline container background) call this. */
export interface PlotBgTokens {
  axesBg: string;
  gridColor: string;
  inkColor: string;
  inkDimColor: string;
  isDark: boolean;
}

export function resolvePlotBg(bg?: PlotBg): PlotBgTokens {
  if ((bg ?? "theme") === "light") {
    return {
      axesBg: cssVar("--axes-bg-light") || "#f7f7fa",
      gridColor: cssVar("--grid-line-light") || "#ccc",
      inkColor: cssVar("--ink-on-light") || "#222",
      inkDimColor: cssVar("--ink-dim-on-light") || "#555",
      isDark: false,
    };
  }
  return {
    axesBg: cssVar("--axes-bg") || "#13131a",
    gridColor: cssVar("--grid-line") || "#333",
    inkColor: cssVar("--ink-on-dark") || "#eee",
    inkDimColor: cssVar("--ink-dim-on-dark") || "#aaa",
    isDark: true,
  };
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

/** Build a uPlot axis `values` formatter for a categorical x-axis
 *  (`PlotPayload.xCategories`, gap #20): `data[0]` holds ORDINAL positions
 *  (0, 1, 2, …), so a tick maps to its label only when it lands exactly on an
 *  in-range integer index — a fractional split (uPlot may propose one
 *  between categories at some zoom levels) or an out-of-range one renders
 *  blank rather than a misleading label. */
export function categoricalTickFormatter(categories: readonly string[]): TickValues {
  return (_u, splits) =>
    splits.map((v) => {
      if (v == null) return null;
      const i = Math.round(v);
      return i >= 0 && i < categories.length && Math.abs(v - i) < 1e-6 ? categories[i] : "";
    });
}

/** A "nice" linear tick step (1/2/5 × 10^n) for a span with no decoded Origin
 *  increment to anchor to — the classic tick-step heuristic, aiming for
 *  roughly `targetTicks` ticks across the span. Used by `fixedLogAxisSplits`
 *  for the sub-decade case when `step` is undecoded. */
export function niceLinearStep(span: number, targetTicks = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, targetTicks);
  const mag = pow10(Math.floor(Math.log10(raw)));
  const residual = raw / mag;
  const nice = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
  return nice * mag;
}

/** Undo float noise from `n * step` accumulation (e.g. `0.1 * 8` reading as
 *  `0.7999999999999999`) so a generated tick prints as the clean decimal it
 *  is meant to be. Ticks are display values, not analysis inputs, so this
 *  precision is more than enough. */
function cleanStepValue(v: number): number {
  return Number(v.toPrecision(12));
}

/** Log-axis tick positions for a FIXED [min, max] range — an applied Origin
 *  figure's saved axis bounds, or a hand-typed Inspector AxisLimits range.
 *  Supplied as uPlot's `axis.splits` OVERRIDE (see `buildOpts`) so it never
 *  falls through to uPlot's own internal log-splits generator, which anchors
 *  its first tick at the raw (unrounded) scaleMin — correct for an
 *  autoscaled range (`rangeLog` rounds the bounds to a decade first), but
 *  wrong for a FIXED range, whose bounds are whatever the figure/user typed
 *  (e.g. Origin's real sub-decade views "Graph50"/"Graph52" in PNR.opj:
 *  y in [0.7139, 1.2732] and [0.9772, 1.2916]) — the plot-fidelity bug this
 *  fixes (ticks like [0.7139, 0.8, 0.9, 1] instead of [0.8, 0.9, 1, 1.1, 1.2]).
 *
 *  - Span ≥ 1 decade: pure powers-of-10 within [min, max] — the same ticks a
 *    rangeLog-rounded autoscale would show (a normal multi-decade
 *    reflectivity view keeps its 1/10/100/... ticks, nothing else).
 *  - Span < 1 decade: ticks stepped arithmetically in LINEAR y-space. `step`
 *    (Origin's decoded major-tick increment) is a LINEAR increment on a log
 *    axis, not a log10/decade multiplier — verified against PNR.opj's
 *    Graph50 (step 0.1 -> ticks 0.8/0.9/1.0/1.1/1.2) and Graph52 (step 0.05).
 *    No decoded step -> `niceLinearStep` picks one.
 *
 *  Degenerate ranges (non-positive, or inverted/zero-width) return `[]`
 *  (uPlot draws the axis line with no ticks rather than garbage). */
export function fixedLogAxisSplits(min: number, max: number, step?: number | null): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const EPS = 1e-9;
  const decades = Math.log10(max / min);
  if (decades >= 1 - EPS) {
    const lo = Math.floor(Math.log10(min) + EPS);
    const hi = Math.ceil(Math.log10(max) - EPS);
    const out: number[] = [];
    for (let k = lo; k <= hi; k++) {
      // pow10, not Math.pow: decade ticks must be the EXACT double for 10^k
      // on every platform (V8's pow drifts on some builds — the CI-only
      // 9.999999999999999e-6 failure of 2026-07-10).
      const v = pow10(k);
      if (v >= min * (1 - EPS) && v <= max * (1 + EPS)) out.push(v);
    }
    return out;
  }
  const s = step && step > 0 ? step : niceLinearStep(max - min);
  const n0 = Math.ceil(min / s - EPS);
  const n1 = Math.floor(max / s + EPS);
  const out: number[] = [];
  for (let n = n0; n <= n1; n++) out.push(cleanStepValue(n * s));
  return out;
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
  /** Peak Analyzer wizard click-on-plot marker editing (interaction item 5,
   *  deferred from closed gap #31): non-null only while wizard step ② is
   *  live (see PlotStage's `peakWizardEdit` store read). Independent of
   *  `tool` — like wheelZoom, it composes with whatever tool is active; only
   *  a plain (non-drag) click over the plot acts. */
  peakWizardEdit?: {
    markers: PeakMarkerCandidate[];
    onAdd: (x: number) => void;
    onRemove: (index: number) => void;
  } | null;
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
  /** Base axis tick/label font size in px (publication template; default 12
   *  as of item 2, 2026-07-09 — was 11). The axis TITLE renders 2px larger
   *  still; see `buildOpts`'s `titlePx`. */
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
  /** Override the x-axis label: a non-empty string shows verbatim; blank
   *  (`""`) or `undefined` derives from the data (today's default, and the
   *  single-plot store convention — see `store/useApp.ts`'s `xAxisLabel`
   *  doc). `null` forces NO title even though data is present — the Origin-
   *  fidelity case (item B, decode-plan #36 residual — PNR.opj Graph11): a
   *  layer whose decoded `x_title` is genuinely `""` (the owner hand-deleted
   *  a redundant per-panel label in Origin) must show nothing, never a
   *  synthesized "channel (unit)" fallback. Only the spatial multi-panel
   *  path (`originFigures.resolveFigurePanels`) ever passes `null`; every
   *  other caller's plain string/undefined behaves exactly as before. */
  xAxisLabel?: string | null;
  /** Override the primary y-axis label; when set it shows even with >1 series
   *  (blank/undefined = the solo-series auto label). */
  yAxisLabel?: string;
  /** Override the secondary y-axis label (Origin double-Y apply carries layer
   *  2's decoded title here); same blank/undefined semantics as yAxisLabel. */
  y2AxisLabel?: string;
  /** Origin's decoded major-tick increment for each axis (see
   *  `fixedLogAxisSplits`'s doc) — only consulted when that axis is BOTH log
   *  AND has a fixed range (xLim/yLim/y2Lim), which is when uPlot's own
   *  decade-snapping is bypassed and this module must supply ticks itself.
   *  null/undefined = undecoded (a "nice number" step fills in instead). */
  xStep?: number | null;
  yStep?: number | null;
  y2Step?: number | null;
  /** This window's background override (item 18) — "theme" (default)
   *  matches today's always-dark plot canvas; "light"/"dark" pin THIS plot
   *  to a fixed background regardless of the app's theme. Resolved via
   *  `resolvePlotBg`. */
  bg?: PlotBg;
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
  // This window's EFFECTIVE background (item 18) drives both the axis/grid/
  // ink colours below AND the contrast check on literal per-series colours
  // (`resolveDrawColor` calls further down) — NOT the app's global theme,
  // since a per-window override can disagree with the surrounding chrome.
  const { gridColor, inkColor, inkDimColor, isDark: isDarkBg } = resolvePlotBg(args.bg);
  const axisColor = inkDimColor;
  const accentColor = cssVar("--accent") || "#8b5cf6";
  const accentSoftColor = cssVar("--accent-soft") || "rgba(139,92,246,0.18)";
  const captureSoftColor = cssVar("--capture-soft") || "rgba(200,160,80,0.16)";
  // Owner 2026-07-09 (item 2, "up the default x/y axis legend and label
  // size"): tick-value font 11px -> 12px default (JetBrains Mono kept —
  // ticks are DATA, per typography.css's mono/UI split). The axis TITLE
  // (e.g. "Temperature (K)") is prose, not data, so it gets the UI font
  // instead, explicitly sized (uPlot's own unstyled default was a fixed,
  // un-themed "bold 12px system-ui…" that never tracked a template's
  // fontSize at all) — 2px over the tick value so it SCALES with whichever
  // plot template is active: the screen default lands exactly on the
  // design tokens' --type-title (14px), while a compact export style
  // (APS/Nature) or a large one (Presentation/Poster) keeps its title
  // legibly bigger than its own ticks instead of a fixed size that would
  // look mismatched at those templates' more extreme fontSize choices.
  const tickPx = args.fontSize ?? 12;
  const font = `${tickPx}px ${cssVar("--font-mono") || "monospace"}`;
  const titlePx = tickPx + 2;
  const labelFont = `600 ${titlePx}px ${cssVar("--font-ui") || "system-ui, sans-serif"}`;
  // X-axis label: an explicit override wins; `null` forces blank (item B —
  // an Origin layer's own DECODED-EMPTY title must never be re-synthesized);
  // blank/undefined derives "name (unit)" from the data (today's default).
  const xLabel =
    args.xAxisLabel === null
      ? ""
      : args.xAxisLabel?.trim() ||
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

  // labelSize is the px height/width uPlot reserves for the axis TITLE
  // (shared by x/y/y2 below) — must grow with `titlePx` so a bigger
  // template's title never clips against the plot area (item 2). Floored at
  // uPlot's own prior default (30) for the same never-shrink reason as
  // xAxisSize/yAxisSize below.
  const labelSize = Math.max(30, titlePx + 20);
  const axis = {
    stroke: axisColor,
    font,
    labelFont,
    labelSize,
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
      refLinePlugin(refLines, inkDimColor, {
        onMove: args.onRefLineMove,
        interactive: tool === "zoom" || tool === "cursor",
      }),
    );
  }
  if (annotations && annotations.length > 0) {
    plugins.push(annotationPlugin(annotations, inkColor, font));
  }
  if (args.errorBars && args.errorBars.size > 0) {
    plugins.push(errorBarsPlugin(args.errorBars, inkDimColor));
  }
  if (args.axisBox) {
    plugins.push(axisBoxPlugin(inkDimColor));
  }
  // Wheel-to-zoom is independent of the active tool (it's a navigation aid, not a
  // drag gesture), so it composes with any tool when the pref is on.
  if (args.wheelZoom) {
    plugins.push(wheelZoomPlugin());
  }
  // Peak wizard click-on-plot marker editing (item 5): also tool-independent —
  // wizard-scoped, not toolbar-tool-scoped (see BuildOptsArgs.peakWizardEdit).
  if (args.peakWizardEdit) {
    const { markers, onAdd, onRemove } = args.peakWizardEdit;
    plugins.push(peakMarkerEditPlugin(markers, { onAdd, onRemove }));
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
  // A categorical x-axis (gap #20) overrides a numeric xFmt: the plotted
  // x values are ordinal positions, not physical quantities, so a fixed/sci
  // number format would show "1.0"/"2.0" instead of the real category names.
  const xValues = payload.xCategories
    ? categoricalTickFormatter(payload.xCategories)
    : tickFormatter(xFmt);
  const yValues = tickFormatter(yFmt);
  // A FIXED range (xLim/yLim/y2Lim — an applied Origin figure or a hand-typed
  // Inspector AxisLimits value) bypasses uPlot's own rangeLog decade-snapping
  // on a log axis, so supply our own splits generator there (see
  // fixedLogAxisSplits's doc for why + the sub-decade Origin-step behaviour).
  // Autoscaled log axes (no fixed range) are untouched — uPlot's own splits
  // already do the right thing once rangeLog has rounded the bounds.
  const splitsFor = (
    isLog: boolean,
    lim: [number, number] | null | undefined,
    step: number | null | undefined,
  ): uPlot.Axis.Splits | undefined =>
    isLog && lim
      ? (_u: uPlot, _axisIdx: number, scaleMin: number, scaleMax: number): number[] =>
          fixedLogAxisSplits(scaleMin, scaleMax, step ?? null)
      : undefined;
  const xSplits = splitsFor(xLog, xLim, args.xStep);
  const ySplits = splitsFor(yLog, yLim, args.yStep);
  // Tick-area `size` (excludes the label, see uPlot's doc) scales with the
  // tick font too — x is a single text line (height-bound, uPlot's own
  // default 50 already has headroom for the +1px bump) so only a small
  // bump; y must additionally fit WIDER digit strings at the bigger font,
  // hence the larger bump (item 2's "must grow with the font" clause). The
  // `Math.max` floors both at the PRE-item-2 widths (uPlot's own 50 for x;
  // our prior flat 60 for y) so a smaller publication template (APS/Nature,
  // fontSize 9) never shrinks below what already rendered fine — this only
  // grows room for a bigger font, never takes it away.
  const xAxisSize = Math.max(50, tickPx + 42);
  const yAxisSize = Math.max(60, tickPx * 4 + 16);
  const axes: uPlot.Axis[] = [
    {
      ...axis,
      size: xAxisSize,
      label: xLabel,
      ...(xValues ? { values: xValues } : {}),
      ...(xSplits ? { splits: xSplits } : {}),
    },
    {
      ...axis,
      size: yAxisSize,
      label: soloLabel(0),
      ...(yValues ? { values: yValues } : {}),
      ...(ySplits ? { splits: ySplits } : {}),
    },
  ];
  if (hasY2) {
    const y2Lim = args.y2Lim ?? null;
    scales.y2 = {
      distr: y2LogEff ? 3 : 1,
      ...(y2Lim ? { range: y2Lim } : loopY2 ? { range: () => loopY2 } : {}),
    };
    const y2Splits = splitsFor(y2LogEff, y2Lim, args.y2Step);
    // Secondary axis on the right; hide its grid so the two grids don't overlap.
    axes.push({
      ...axis,
      scale: "y2",
      side: 1,
      size: yAxisSize,
      label: soloLabel(1),
      grid: { show: false },
      ...(yValues ? { values: yValues } : {}),
      ...(y2Splits ? { splits: y2Splits } : {}),
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
        // Literal per-series overrides (e.g. an Origin-imported figure's
        // saved line colour) are checked for contrast against THIS window's
        // effective background and swapped for the ink token when they'd be
        // invisible (a literal black stroke on our dark canvas, or literal
        // white on a "light" override) — never mutates the stored style, so
        // a theme/background switch re-resolves live. Default palette
        // colours (`--series-N`) pass through unchanged (already
        // theme-designed for contrast; see `resolveDrawColor`'s doc).
        const stroke = resolveDrawColor(seriesColor(i, style), isDarkBg, inkColor);
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
