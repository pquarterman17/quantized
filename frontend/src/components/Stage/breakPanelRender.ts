// The paneled X-BREAK leg of `useMultiPanelStage`'s one DOM-manipulating
// render effect, extracted as a sibling exactly the way `facetGridRender.ts`
// was (BUG-014 round 4): the hook sits at its module-size pin, and this leg
// needed the same new per-panel argument the facet leg got (`seriesLabels`).
// The hook keeps mode selection, state and the effect's lifecycle; this file
// owns "given a host div, N break panels and one set of cell options, build
// the uPlot instances" — including the seam glyph between them.
//
// Why `seriesLabels` matters here (BUG-014): `buildOpts` sets
// `legend: { show: false }` and `PlotStage.tsx` mounts `MultiPanelStage`
// INSTEAD of `PlotViewport` + `PlotLegend`, so the only slot on a panel that
// shows a series' resolved name is the y-axis label (`uplotOpts.soloLabel`,
// which reads the same resolved `labels` array `seriesLabels` overrides).
// Before BUG-014 round 4 the break leg passed no renames at all, so a renamed
// channel read its derived "Signal (au)" on screen while the export of the
// same view carried "Loop 1" (`lib/figureSpec.ts` -> `series_styles[i].legend`
// — a break view exports as the flat figure). The map is CHANNEL-keyed and
// projected PER PANEL through that panel's own `BreakPanel.channels`
// (BUG-014 round 5), exactly as `facetGridRender.ts` projects it through
// `FacetPanel.channels`: a break panel's channel list is resolved over its
// own x-slice, so two panels of one view can legitimately hold different
// channels and a positional list shared by every panel would mislabel.
//
// The parity this buys is exact only where a break panel HAS a visible name
// slot: `soloLabel` paints the y-axis only when a SINGLE series sits on that
// axis, so a multi-channel break panel (no legend, no solo axis label) still
// shows no series name on screen while the export carries the rename — a
// recorded residual, not something this projection closes.
//
// `seriesStyles` rides the SAME per-panel projection (R1, the regression
// matrix's S2): the leg used to pass none, so an explicit width / colour /
// dash fell back to the defaults on every break panel (a width-2 line drew at
// 1.5) while the export — the flat figure — carried them.
//
// Error bars (plot audit leftovers): each panel draws the bars of its OWN rows
// (`BreakPanel.data`), from the same bindings as the flat plot — role spans
// (asymmetric, X/dQ) plus the legacy `errKeys` whiskers — so `buildOpts`'
// plugins colour them by series and skip hidden ones exactly as unbroken. An
// auto shared y range widens to cover them under the flat plot's log floor
// (`lib/uplotErrorRange.ts`); the export draws the same bars per panel
// (`calc/figure_break.py`).

import uPlot from "uplot";

import { buildErrorColumns, buildErrorSpans, type ErrorSpan } from "../../lib/errorbars";
import type { ErrorBinding } from "../../lib/errorRoles";
import type { BreakPanel } from "../../lib/facet";
import { breakPanelWidths, xZoomSyncHook } from "../../lib/multipanel";
import type { SeriesStyle } from "../../lib/types";
import { errorReach } from "../../lib/uplotErrorRange";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import { buildOpts, type BuildOptsArgs } from "../../lib/uplotOpts";

/** The width of the hashed seam drawn between two adjacent break panels. */
const BREAK_GLYPH_W = 20;

/** Everything a break panel's `buildOpts` call needs that is the SAME for
 *  every panel. `width`/`height` (the computed panel box), `xLim` (the
 *  panel's own x-segment), `seriesLabels` and `seriesStyles` are per-panel and
 *  supplied by `renderBreakPanels` itself. */
export type BreakCellOpts = Omit<
  BuildOptsArgs,
  "width" | "height" | "xLim" | "seriesLabels" | "seriesStyles" | "hidden" | "linearPaths" | "pointsPaths" | "errorBars" | "errorSpans"
>;

/** The error bindings the flat plot draws from: the dataset's role bindings
 *  (spans) and the view's legacy `errKeys` (symmetric y whiskers). */
export interface BreakErrors {
  roles: readonly ErrorBinding[] | undefined;
  errKeys: Record<number, number>;
}

export interface BreakPanelsArgs {
  panels: readonly BreakPanel[];
  /** The store's per-CHANNEL legend renames, projected onto each panel's own
   *  `channels` list below. `{}` (every pre-BUG-014 break view) leaves every
   *  panel reading its derived "label (unit)". */
  seriesLabels: Record<number, string>;
  /** The store's per-CHANNEL styles (the flat plot's `seriesStyles`),
   *  projected onto each panel's `channels` the same way. */
  seriesStyles: Record<number, SeriesStyle>;
  /** The window's hidden CHANNELS. A hidden channel stays in its panel's
   *  payload with `show: false`, as on the flat canvas, so it is not drawn
   *  while the export (which drops it) is matched series for series. */
  hiddenChannels: readonly number[];
  /** Absent: no error bars (as before). */
  errors?: BreakErrors;
  /** uPlot cursor-sync group; see `MULTIPANEL_SYNC_KEY`. */
  syncKey: string;
  /** `cell.yLim` is the panels' shared DATA extent (no typed limit), so pad it
   *  by uPlot's own auto rule, as an unbroken plot's y is. */
  yAuto?: boolean;
  /** The host box to lay the row out in (the caller's `clientWidth || 600` /
   *  `clientHeight || 400`), reused as the resize fallback. */
  box: { w: number; h: number };
  cell: BreakCellOpts;
}

/** The visual seam between adjacent x-break panels: diagonal hash lines via a
 *  pure CSS gradient (theme-aware through the `--border` token) rather than a
 *  text glyph, so it never depends on font rendering. */
function makeBreakGlyph(width: number): HTMLDivElement {
  const glyph = document.createElement("div");
  glyph.setAttribute("aria-hidden", "true");
  glyph.style.cssText =
    `flex:0 0 ${width}px;align-self:stretch;` +
    "background-image:repeating-linear-gradient(65deg, var(--border) 0 2px, transparent 2px 9px);" +
    "opacity:0.7;";
  return glyph;
}

interface PanelBars {
  errorBars?: Map<number, (number | null)[]>;
  errorSpans?: Map<number, ErrorSpan[]>;
}

/** One panel's bars, keyed by its payload column like the flat plot's. */
function panelBars(p: BreakPanel, errors: BreakErrors | undefined): PanelBars {
  if (!errors || !p.data) return {};
  const spans = errors.roles?.length ? buildErrorSpans(p.data, p.channels, errors.roles) : undefined;
  const bars = buildErrorColumns(p.data, p.channels, errors.errKeys);
  return {
    ...(bars.size ? { errorBars: bars } : {}),
    ...(spans?.size ? { errorSpans: spans } : {}),
  };
}

/** `lim` widened by every visible panel's y bar ends — the flat plot's
 *  autoscale rule, ends under the log floor (two decades below the lowest
 *  point) skipped as `uplotErrorRange.errorRange` skips them. */
function widenByBars(
  lim: [number, number],
  panels: readonly BreakPanel[],
  bars: readonly PanelBars[],
  hidden: readonly number[],
  positiveOnly: boolean,
): [number, number] {
  let [lo, hi] = lim;
  const floor = positiveOnly ? lim[0] / 100 : -Infinity;
  panels.forEach((p, i) => {
    for (const e of errorReach(p.payload, bars[i].errorBars, bars[i].errorSpans) ?? []) {
      if (e.on !== 0 || hidden.includes(p.channels[e.series])) continue;
      for (const v of e.rows.flat()) if (v > floor) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
    }
  });
  return [lo, hi];
}

/** Each built row's panel x spans, for `resizeBreakPanels`. */
const rowSpans = new WeakMap<readonly uPlot[], number[]>();

/** Size `plots` across `width` px so each PLOT AREA's width is in proportion
 *  to its panel's x span — the export's `width_ratios`
 *  (`calc/figure_break.py`), so a slope reads the same in every panel. Each
 *  panel keeps its own axis gutters on top (each names its own channels). */
function layoutRow(plots: readonly uPlot[], spans: readonly number[], width: number, height: number): void {
  const off = plots.map((u) => Math.max(0, u.width - (u.bbox?.width ?? u.width) / (uPlot.pxRatio || 1)) || 0);
  const free = Math.max(plots.length, width - (plots.length - 1) * BREAK_GLYPH_W - off.reduce((a, b) => a + b, 0));
  const total = spans.reduce((a, b) => a + b, 0);
  plots.forEach((u, i) => {
    const w = Math.max(1, Math.floor(off[i] + (free * spans[i]) / total));
    if (u.root?.parentElement) u.root.parentElement.style.flex = `0 0 ${w}px`;
    u.setSize({ width: w, height });
  });
}

/** Build one uPlot per break panel into `host` (which the caller has already
 *  emptied), seam glyphs between them, and return the plots in panel order. */
export function renderBreakPanels(host: HTMLDivElement, args: BreakPanelsArgs): uPlot[] {
  const widths = breakPanelWidths(args.panels.length, args.box.w, BREAK_GLYPH_W);
  // One y scale across the break (an axis break elides x only): a y zoom,
  // wheel or pan on one panel moves them all.
  const plots: uPlot[] = [];
  const ySync = xZoomSyncHook(() => plots, "y");
  const { yScale } = args.cell;
  const bars = args.panels.map((p) => panelBars(p, args.errors));
  const yLim = args.yAuto && args.cell.yLim
    ? widenByBars(args.cell.yLim, args.panels, bars, args.hiddenChannels, yScale !== "linear")
    : args.cell.yLim;
  const padded =
    args.yAuto && yLim && yScale !== "reciprocal" && typeof uPlot.rangeNum === "function" // (a test's mock may lack it)
      ? ((yScale === "log" ? uPlot.rangeLog(yLim[0], yLim[1], 10, false) : uPlot.rangeNum(yLim[0], yLim[1], 0.1, true)) as [number, number])
      : null;
  args.panels.forEach((p, i) => {
    if (i > 0) host.appendChild(makeBreakGlyph(BREAK_GLYPH_W));
    const div = document.createElement("div");
    div.style.flex = `0 0 ${widths[i]}px`;
    host.appendChild(div);
    const opts = buildOpts(p.payload, {
      ...args.cell,
      width: widths[i],
      height: args.box.h,
      // A break panel's whole point is showing only its own x-slice.
      xLim: p.xRange,
      yLim: padded ?? yLim,
      // `channels[i]` is the dataset channel behind `payload.series[i]`, by
      // construction in `lib/facet.breakPayloads` — so a rename lands on the
      // channel it was made for even when this panel's channel list differs
      // from its neighbour's.
      seriesLabels: p.channels.map((ch) => args.seriesLabels[ch]),
      seriesStyles: p.channels.map((ch) => args.seriesStyles[ch]),
      hidden: p.channels.map((ch) => args.hiddenChannels.includes(ch)),
      ...bars[i],
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    // Cursor sync by shared y only: uPlot maps a synced cursor or box-zoom
    // selection BY X VALUE, which put the left panel's x slice on the right.
    opts.cursor = { ...opts.cursor, sync: { key: args.syncKey, scales: ["x", "y"], match: [() => false, (a, b) => a === b] } };
    // No x-zoom sync: each panel shows its OWN x-slice, so copying one
    // panel's x domain onto another would show the wrong slice there.
    opts.hooks = { ...opts.hooks, setScale: [...(opts.hooks?.setScale ?? []), ySync] };
    plots.push(new uPlot(opts, p.payload.data, div));
  });
  const spans = args.panels.map((p) => Math.max(p.xRange[1] - p.xRange[0], 1e-9));
  rowSpans.set(plots, spans);
  // Twice: a panel's gutters move a little with its width (x tick overhang).
  for (let k = 0; k < 2; k++) layoutRow(plots, spans, args.box.w, args.box.h);
  return plots;
}

/** Re-size an already-built break row to `host`'s current box — the
 *  ResizeObserver half, kept beside the build so the two can never disagree
 *  about how a panel's width is computed. `fallback` is the box the row was
 *  BUILT at, used when the host reports 0 (detached/hidden), exactly as the
 *  in-hook version's captured `w`/`h` did. */
export function resizeBreakPanels(
  host: HTMLDivElement,
  plots: readonly uPlot[],
  fallback: { w: number; h: number },
): void {
  const width = host.clientWidth || fallback.w;
  const height = host.clientHeight || fallback.h;
  for (let k = 0; k < 2; k++) layoutRow(plots, rowSpans.get(plots) ?? plots.map(() => 1), width, height);
}
