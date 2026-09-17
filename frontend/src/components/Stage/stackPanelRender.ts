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

/** Build one uPlot per stacked panel into `host` (which the caller has
 *  already emptied) and return them in panel order. */
export function renderStackPanels(host: HTMLDivElement, args: StackPanelsArgs): uPlot[] {
  const heights = panelHeights(args.panels.length, args.box.h);
  return args.panels.map((pp, i) => {
    const div = document.createElement("div");
    host.appendChild(div);
    const opts = buildOpts(pp, {
      ...args.cell,
      width: args.box.w,
      height: heights[i],
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
    // the plot areas stay the same width and the panels line up).
    const isBottom = i === args.panels.length - 1;
    if (!isBottom && opts.axes?.[0]) {
      opts.axes[0] = { ...opts.axes[0], label: undefined, values: (_u, splits) => splits.map(() => "") };
    }
    return new uPlot(opts, pp.data, div);
  });
}

/** Re-size an already-built stack to `host`'s current box — the
 *  ResizeObserver half, kept beside the build so the two can never disagree
 *  about how a panel's height is computed. `fallbackW` is the width the stack
 *  was BUILT at, used when the host reports 0 (detached/hidden); the height
 *  keeps the in-hook version's own `clientHeight || 400` fallback. */
export function resizeStackPanels(host: HTMLDivElement, plots: readonly uPlot[], fallbackW: number): void {
  const hs = panelHeights(plots.length, host.clientHeight || 400);
  const width = host.clientWidth || fallbackW;
  plots.forEach((u, idx) => u.setSize({ width, height: hs[idx] }));
}
