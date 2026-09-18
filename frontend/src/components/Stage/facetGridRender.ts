// The facet-grid leg of `useMultiPanelStage`'s one DOM-manipulating render
// effect, extracted as a sibling (BUG-014 review round): the hook sits at its
// module-size pin, and the leg needed a new per-panel argument
// (`seriesLabels`). Same split the spatial/stack legs would take if they grew
// — the hook keeps mode selection, state and the effect's lifecycle; this
// file owns "given a host div, N facet panels and one set of cell options,
// build the uPlot instances".
//
// Why `seriesLabels` matters here (BUG-014): a legend rename is per CHANNEL,
// and until this round the facet grid passed NO renames to `buildOpts` at
// all, so a renamed series read `Signal (au)` in a facet panel on screen
// while the flat plot beside it read `Loop 1`. `buildOpts` resolves a series'
// legend as `args.seriesLabels?.[i] ?? (unit ? "label (unit)" : label)`, so
// handing it the panel's own channel-keyed renames is the whole fix — and it
// is the exact rule `lib/figureSpecFacets.ts` applies on the export side
// (`seriesDisplayLabel`), which is what makes the two legs agree.

import uPlot from "uplot";

import type { FacetPanel } from "../../lib/facet";
import { cellSize, type xZoomSyncHook } from "../../lib/multipanel";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import { buildOpts, type BuildOptsArgs } from "../../lib/uplotOpts";

/** Everything a facet cell's `buildOpts` call needs that is the SAME for
 *  every panel. `width`/`height` (the computed cell size), `title` (the
 *  panel's level label) and `seriesLabels` (its channel-keyed renames) are
 *  per-panel and supplied by `renderFacetGrid` itself. */
export type FacetCellOpts = Omit<
  BuildOptsArgs,
  "width" | "height" | "title" | "seriesLabels" | "linearPaths" | "pointsPaths"
>;

export interface FacetGridArgs {
  panels: readonly FacetPanel[];
  /** Per-channel legend renames (the store's `seriesLabels`), projected onto
   *  each panel's own `channels` list. */
  seriesLabels: Record<number, string>;
  grid: { rows: number; cols: number };
  gap: number;
  /** uPlot cursor-sync group; see `MULTIPANEL_SYNC_KEY`. */
  syncKey: string;
  /** The shared x-zoom/pan propagation hook — one instance for the whole
   *  panel set, created by the caller so it can read the live instance list. */
  onSetScale: ReturnType<typeof xZoomSyncHook>;
  /** The host box to lay the grid out in (the caller's
   *  `clientWidth || 600` / `clientHeight || 400`), reused as the resize
   *  fallback. */
  box: { w: number; h: number };
  cell: FacetCellOpts;
}

/** Build one uPlot per facet panel into `host` (which the caller has already
 *  emptied) and return them in panel order. */
export function renderFacetGrid(host: HTMLDivElement, args: FacetGridArgs): uPlot[] {
  const { cellW, cellH } = cellSize(args.box.w, args.box.h, args.grid, args.gap);
  return args.panels.map((p) => {
    const div = document.createElement("div");
    host.appendChild(div);
    const opts = buildOpts(p.payload, {
      ...args.cell,
      width: cellW,
      height: cellH,
      title: p.label,
      // `channels[i]` is the dataset channel behind `payload.series[i]`,
      // carried by the panel because the default (null `yKeys`) channel list
      // is resolved per row-slice and can differ panel to panel.
      seriesLabels: p.channels.map((ch) => args.seriesLabels[ch]),
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    opts.cursor = { ...opts.cursor, sync: { key: args.syncKey } };
    opts.hooks = { setScale: [args.onSetScale] };
    return new uPlot(opts, p.payload.data, div);
  });
}

/** Re-size an already-built facet grid to `host`'s current box — the
 *  ResizeObserver half, kept beside the build so the two can never disagree
 *  about how a cell's size is computed. `fallback` is the box the grid was
 *  BUILT at, used when the host reports 0 (detached/hidden), exactly as the
 *  in-hook version's captured `w`/`h` did. */
export function resizeFacetGrid(
  host: HTMLDivElement,
  plots: readonly uPlot[],
  grid: { rows: number; cols: number },
  gap: number,
  fallback: { w: number; h: number },
): void {
  const w = host.clientWidth || fallback.w;
  const h = host.clientHeight || fallback.h;
  const { cellW, cellH } = cellSize(w, h, grid, gap);
  plots.forEach((u) => u.setSize({ width: cellW, height: cellH }));
}
