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
// Until this round the break leg passed no renames at all, so a renamed
// channel read its derived "Signal (au)" on screen while the export of the
// same view carried "Loop 1" (`lib/figureSpec.ts` -> `series_styles[i].legend`
// — a break view exports as the flat figure). The array is POSITIONAL, one
// entry per series of every panel's payload, because every break panel is the
// same channel set sliced to its own x-segment.

import uPlot from "uplot";

import type { BreakPanel } from "../../lib/facet";
import { breakPanelWidths } from "../../lib/multipanel";
import type { xZoomSyncHook } from "../../lib/multipanel";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import { buildOpts, type BuildOptsArgs } from "../../lib/uplotOpts";

/** The width of the hashed seam drawn between two adjacent break panels. */
const BREAK_GLYPH_W = 20;

/** Everything a break panel's `buildOpts` call needs that is the SAME for
 *  every panel. `width`/`height` (the computed panel box), `xLim` (the
 *  panel's own x-segment) and `seriesLabels` are per-panel and supplied by
 *  `renderBreakPanels` itself. */
export type BreakCellOpts = Omit<
  BuildOptsArgs,
  "width" | "height" | "xLim" | "seriesLabels" | "linearPaths" | "pointsPaths"
>;

export interface BreakPanelsArgs {
  panels: readonly BreakPanel[];
  /** Per-series legend renames, positional over the payload's series (the
   *  caller projects the channel-keyed store map onto the panels' channel
   *  list). `undefined` = no renames resolved for this arrangement, which is
   *  what every pre-BUG-014 break view passed. */
  seriesLabels?: (string | undefined)[];
  /** uPlot cursor-sync group; see `MULTIPANEL_SYNC_KEY`. */
  syncKey: string;
  /** The shared x-zoom/pan propagation hook — one instance for the whole
   *  panel set, created by the caller so it can read the live instance list. */
  onSetScale: ReturnType<typeof xZoomSyncHook>;
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

/** Build one uPlot per break panel into `host` (which the caller has already
 *  emptied), seam glyphs between them, and return the plots in panel order. */
export function renderBreakPanels(host: HTMLDivElement, args: BreakPanelsArgs): uPlot[] {
  const widths = breakPanelWidths(args.panels.length, args.box.w, BREAK_GLYPH_W);
  return args.panels.map((p, i) => {
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
      seriesLabels: args.seriesLabels,
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    opts.cursor = { ...opts.cursor, sync: { key: args.syncKey } };
    opts.hooks = { setScale: [args.onSetScale] };
    return new uPlot(opts, p.payload.data, div);
  });
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
  const ws = breakPanelWidths(plots.length, width, BREAK_GLYPH_W);
  plots.forEach((u, idx) => u.setSize({ width: ws[idx], height }));
}
