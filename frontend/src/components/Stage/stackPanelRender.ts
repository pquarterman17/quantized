// The plain per-channel STACK leg of `useMultiPanelStage`'s one
// DOM-manipulating render effect, extracted as a sibling exactly the way
// `facetGridRender.ts` and `breakPanelRender.ts` were (BUG-014 round 4): the
// hook sits at its module-size pin, and this leg needed the same new
// per-panel argument the facet leg got (`seriesLabels`). The hook keeps mode
// selection, state and the effect's lifecycle; this file owns "given a host
// div, N one-series panels and one set of cell options, build the uPlot
// instances".
//
// Why `seriesLabels` matters here (BUG-014): `buildOpts` sets
// `legend: { show: false }` and `PlotStage.tsx` mounts `MultiPanelStage`
// INSTEAD of `PlotViewport` + `PlotLegend`, so the only slot showing a
// series' resolved name is the y-axis label (`uplotOpts.soloLabel`) — and a
// stack panel is single-series, so its y-axis label IS that series' legend
// text. Until this round the stack leg passed no renames, so a renamed
// channel read its derived "Signal (au)" on screen while the export of the
// same view carried "Loop 1" (`lib/figureSpec.ts` -> `series_styles[i].legend`
// — a stack view exports as the flat figure).

import uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import { panelHeights, type xZoomSyncHook } from "../../lib/multipanel";
import type { SeriesStyle } from "../../lib/types";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import { buildOpts, type BuildOptsArgs } from "../../lib/uplotOpts";

/** Everything a stack panel's `buildOpts` call needs that is the SAME for
 *  every panel. `width`/`height`, and the three per-panel lists below, are
 *  supplied by `renderStackPanels` itself. */
export type StackCellOpts = Omit<
  BuildOptsArgs,
  "width" | "height" | "seriesStyles" | "seriesLabels" | "errorBars" | "linearPaths" | "pointsPaths"
>;

export interface StackPanelsArgs {
  /** One single-series payload per plotted channel (`multipanel.splitPayload`). */
  panels: readonly PlotPayload[];
  /** Per-channel legend renames, in the SAME plotted-channel order as
   *  `panels` — entry `i` is panel `i`'s only series. `undefined` there is
   *  "not renamed", which is every channel of every pre-BUG-014 view. */
  seriesLabels: readonly (string | undefined)[];
  /** Per-channel style overrides, same order/keying as `seriesLabels`. */
  seriesStyles: readonly (SeriesStyle | undefined)[];
  /** Per-panel error-bar columns (each panel is its own single-series uPlot,
   *  so each map is keyed from that panel's own column 1). */
  errorBars: readonly (Map<number, (number | null)[]> | undefined)[];
  /** uPlot cursor-sync group; see `MULTIPANEL_SYNC_KEY`. */
  syncKey: string;
  /** The shared x-zoom/pan propagation hook — one instance for the whole
   *  panel set, created by the caller so it can read the live instance list. */
  onSetScale: ReturnType<typeof xZoomSyncHook>;
  /** The host box to lay the column out in (the caller's
   *  `clientWidth || 600` / `clientHeight || 400`); `w` is reused as the
   *  resize fallback. */
  box: { w: number; h: number };
  cell: StackCellOpts;
}

/** The x-axis band (px) kept on every panel above the bottom one: room for
 *  the tick marks only, since their tick labels and title are blank. */
const TICK_BAND = 8;

/** How much taller the bottom panel is than the rest, per built stack: its
 *  full x-axis band (tick labels + title) minus the others' `TICK_BAND`. */
const bottomExtra = new WeakMap<readonly uPlot[], number>();

/** Panel heights giving every plot AREA the same height: the bottom panel
 *  also carries `extra` px of x axis. Never below 1 px (as `panelHeights`). */
function stackHeights(n: number, total: number, extra: number): number[] {
  const hs = panelHeights(n, total - extra);
  if (n) hs[n - 1] += extra;
  return hs;
}

/** Build one uPlot per stacked panel into `host` (which the caller has
 *  already emptied) and return them in panel order. */
export function renderStackPanels(host: HTMLDivElement, args: StackPanelsArgs): uPlot[] {
  const n = args.panels.length;
  const built = args.panels.map((pp, i) => {
    const opts = buildOpts(pp, {
      ...args.cell,
      width: args.box.w,
      height: 0,
      seriesStyles: [args.seriesStyles[i]],
      seriesLabels: [args.seriesLabels[i]],
      // Item A: same class of fix as the spatial multi-panel path — an
      // Origin "Y-error" column is already dropped from `plotted`, so its
      // paired Y channel's own panel draws whiskers instead.
      errorBars: args.errorBars[i],
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    opts.cursor = { ...opts.cursor, sync: { key: args.syncKey } };
    opts.hooks = { setScale: [args.onSetScale] };
    // Blank the x tick labels on every panel but the bottom (keep the axis so
    // the plot areas stay the same width and the panels line up), and shrink
    // its band to the tick marks: blank labels reserved ~70 px per panel.
    if (i < n - 1 && opts.axes?.[0]) {
      opts.axes[0] = { ...opts.axes[0], label: undefined, size: TICK_BAND, values: (_u, splits) => splits.map(() => "") };
    }
    return opts;
  });
  const x = built[n - 1]?.axes?.[0];
  const extra = x ? Math.max(0, Number(x.size) + (x.label != null ? Number(x.labelSize) : 0) - TICK_BAND) || 0 : 0;
  const heights = stackHeights(n, args.box.h, extra);
  const plots = built.map((opts, i) => {
    const div = document.createElement("div");
    host.appendChild(div);
    return new uPlot({ ...opts, height: heights[i] }, args.panels[i].data, div);
  });
  bottomExtra.set(plots, extra);
  return plots;
}

/** Re-size an already-built stack to `host`'s current box — the
 *  ResizeObserver half, kept beside the build so the two can never disagree
 *  about how a panel's height is computed. `fallbackW` is the width the stack
 *  was BUILT at, used when the host reports 0 (detached/hidden); the height
 *  keeps the in-hook version's own `clientHeight || 400` fallback. */
export function resizeStackPanels(host: HTMLDivElement, plots: readonly uPlot[], fallbackW: number): void {
  const hs = stackHeights(plots.length, host.clientHeight || 400, bottomExtra.get(plots) ?? 0);
  const width = host.clientWidth || fallbackW;
  plots.forEach((u, idx) => u.setSize({ width, height: hs[idx] }));
}
