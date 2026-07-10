// State + imperative uPlot-instance render effect for MultiPanelStage.tsx
// (kept a thin view, the `useStatStage`/`StatStage.tsx` precedent). Extracted
// so the view component stays under the ~400-line convention once a 4th mode
// (paneled x-breaks) landed. FOUR modes share one host div, in store
// precedence order: spatial > break > facet > plain per-channel stack
// (defensive — the store keeps `spatialPanels`/`breakPanels`/`facetPanels`
// mutually exclusive, see their doc comments in `store/useApp.ts`). See
// `MultiPanelStage.tsx`'s module doc for what each mode means; this file owns
// the store reads, the payload-building effects, and the one DOM-manipulating
// uPlot-instance effect.

import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";

import { buildErrorColumns } from "../../lib/errorbars";
import { sharedXDomain, sharedYDomain } from "../../lib/facet";
import { effectiveChannels, fetchPlot, type PlotPayload } from "../../lib/plotdata";
import {
  breakPanelWidths,
  cellSize,
  facetGridSize,
  panelHeights,
  spatialGridSize,
  spatialPlottedChannels,
  splitPayload,
  xZoomSyncHook,
} from "../../lib/multipanel";
import {
  columnWidths,
  cumulativeOffsets,
  rowBoundaryGaps,
  rowHeights,
  suppressedXIndices,
} from "../../lib/panelLayout";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import { buildOpts } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotTools";
import { useActiveDataset, useApp } from "../../store/useApp";

const SYNC_KEY = "qz-multipanel";
const GRID_GAP = 8;
const BREAK_GLYPH_W = 20;

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

/** One spatial panel's fetched series plus its own error-bar map (built at
 *  fetch time — needs the panel's full DataStruct, not just the plotted
 *  payload — see the fetch effect below). */
interface SpatialFetch {
  payload: PlotPayload;
  errorBars: Map<number, (number | null)[]>;
}

export interface MultiPanelStageState {
  hostRef: RefObject<HTMLDivElement | null>;
  hostStyle: CSSProperties;
  readout: Readout | null;
  tool: string;
}

export function useMultiPanelStage(): MultiPanelStageState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const rawSpatialPanels = useApp((s) => s.spatialPanels);
  const facetPanels = useApp((s) => s.facetPanels);
  const breakPanels = useApp((s) => s.breakPanels);
  const yLog = useApp((s) => s.yLog);
  const xLog = useApp((s) => s.xLog);
  const xLim = useApp((s) => s.xLim);
  const yLim = useApp((s) => s.yLim);
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const showGrid = useApp((s) => s.showGrid);
  const showAxisBox = useApp((s) => s.showAxisBox);
  const refLines = useApp((s) => s.refLines);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  // Item A (PNR.opj Book14 Graph11 repro): the same "Y-error"-designated
  // column bug also hits the plain per-channel stack mode (any Origin book
  // manually stacked, not just an applied multi-layer figure) — these are
  // the SAME store fields PlotStage/usePlotPayload already read for the
  // single-plot view, just threaded into this mode's own fetch/render below.
  const errKeys = useApp((s) => s.errKeys);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const tool = useApp((s) => s.plotTool);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotsRef = useRef<uPlot[]>([]);
  const [payload, setPayload] = useState<PlotPayload | null>(null);
  const [spatialPayloads, setSpatialPayloads] = useState<(SpatialFetch | null)[]>([]);
  const [readout, setReadout] = useState<Readout | null>(null);

  // Spatial panels whose dataset still exists (a removed dataset degrades to
  // dropping that one cell, never a crash).
  const panels = useMemo(
    () => (rawSpatialPanels ?? []).filter((p) => datasets.some((d) => d.id === p.datasetId)),
    [rawSpatialPanels, datasets],
  );
  const spatial = panels.length > 0;
  const grid = useMemo(() => spatialGridSize(panels), [panels]);

  // Paneled x-breaks (gap #21 residual) and facet grid: the store keeps
  // spatial/break/facet mutually exclusive; this precedence is defensive.
  const breakMode = !spatial && (breakPanels?.length ?? 0) > 0;
  const facet = !spatial && !breakMode && (facetPanels?.length ?? 0) > 0;
  const facetGrid = useMemo(() => facetGridSize(facetPanels?.length ?? 0), [facetPanels]);
  // The explicit store xLim (a manual override / prior zoom) wins; otherwise
  // the union domain across every facet panel — one shared horizontal scale.
  const facetXLim = useMemo(
    () => (facet ? (xLim ?? sharedXDomain(facetPanels!)) : null),
    [facet, facetPanels, xLim],
  );
  // Break panels share ONE y-domain instead (each keeps its own x-range) — an
  // honest axis break only elides x, never y.
  const breakYLim = useMemo(
    () => (breakMode ? (yLim ?? sharedYDomain(breakPanels!)) : null),
    [breakMode, breakPanels, yLim],
  );

  // Channels actually drawn (y selection minus the x-axis channel), in order
  // — the plain per-channel stack mode only.
  const plotted = useMemo(
    () =>
      !spatial && !facet && !breakMode && active
        ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder).filter(
            (c) => !hiddenChannels.includes(c),
          )
        : [],
    [spatial, facet, breakMode, active, yKeys, xKey, seriesOrder, hiddenChannels],
  );
  const styleList = useMemo(() => plotted.map((ch) => seriesStyles[ch]), [plotted, seriesStyles]);
  // One error-bar map per stacked panel (each panel is a single-series uPlot
  // instance, so its own column index is always 1 — see `buildErrorColumns`'s
  // 1-based keying). Mirrors `usePlotPayload.errorBars`, scoped per panel.
  const errorBarsList = useMemo(
    () => (active ? plotted.map((ch) => buildErrorColumns(active.data, [ch], errKeys)) : []),
    [active, plotted, errKeys],
  );

  useEffect(() => {
    let cancelled = false;
    if (spatial || facet || breakMode || !active) {
      setPayload(null);
      return;
    }
    // ORIGIN_FILE_DECODE_PLAN #38: the active dataset may still be a lazy
    // Origin book — trigger its full-data fetch; the payload below renders
    // from whatever `active.data` currently is (preview now, full once the
    // fetch lands and this effect re-runs off the `active` dependency).
    if (active.pending) useApp.getState().ensureBookData(active.id);
    fetchPlot(active.data, yLog, xLog, plotted, y2Keys, xKey).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [spatial, facet, breakMode, active, yLog, xLog, plotted, y2Keys, xKey]);

  useEffect(() => {
    let cancelled = false;
    if (!spatial) {
      // Functional update that keeps the SAME [] reference when already
      // empty: a fresh `[]` literal here would be referentially unequal to
      // the prior empty state on every non-spatial render, triggering a
      // pointless extra render that re-runs (and re-builds) the uPlot
      // instances in the render effect below (it depends on
      // `spatialPayloads`) a second time on every facet/break/plain-stack
      // mount or mode switch.
      setSpatialPayloads((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    Promise.all(
      panels.map((p) => {
        const ds = datasets.find((d) => d.id === p.datasetId);
        // Each panel owns its OWN dataset (decode-plan #36) — a spatial
        // multi-panel apply can bind several lazy books at once, so every
        // panel's own book needs its own fetch trigger (#38), not just the
        // "active" one.
        if (ds?.pending) useApp.getState().ensureBookData(ds.id);
        if (!ds) return Promise.resolve(null);
        // Item A (PNR.opj Book14 Graph11 repro): drop this panel's Origin-
        // hidden channels (a "Y-error" column like dSA) from what's actually
        // fetched/plotted — the spatial grid has no per-panel legend to keep
        // them toggle-able, unlike the single-plot path (see
        // `multipanel.spatialPlottedChannels`'s doc). y2Keys is filtered the
        // same way for consistency, though a hidden channel is never itself
        // curve-bound to y2 in practice.
        const plottedChannels = spatialPlottedChannels(p);
        const y2 = p.y2Keys ? p.y2Keys.filter((ch) => plottedChannels.includes(ch)) : null;
        // A panel carrying a merged y2 overlay (decode-plan #36 residual —
        // `originFigures.resolveSpatialPanels`) passes its OWN y2Keys so the
        // fetched payload tags those series `axis: 1`, same as the single-
        // plot double-Y apply.
        return fetchPlot(ds.data, p.yLog, p.xLog, plottedChannels, y2, p.xKey).then(
          (fetched): SpatialFetch => ({
            payload: fetched,
            // Error-bar magnitudes for THIS panel's own dataset/designations
            // (`originFigures.figureChannelSelection` populated `p.errKeys`),
            // keyed to the SAME plottedChannels order the payload's series
            // are in.
            errorBars: buildErrorColumns(ds.data, plottedChannels, p.errKeys ?? {}),
          }),
        );
      }),
    ).then((ps) => {
      if (!cancelled) setSpatialPayloads(ps);
    });
    return () => {
      cancelled = true;
    };
  }, [spatial, panels, datasets]);

  useEffect(() => {
    const host = hostRef.current;
    const destroyAll = () => {
      plotsRef.current.forEach((p) => p.destroy());
      plotsRef.current = [];
    };
    if (!host) {
      destroyAll();
      return;
    }

    if (spatial) {
      if (spatialPayloads.length !== panels.length || spatialPayloads.some((p) => !p)) {
        destroyAll();
        return;
      }
      destroyAll();
      host.replaceChildren();
      const w = host.clientWidth || 600;
      const h = host.clientHeight || 400;
      // Item B (decode-plan #36 residual, PNR.opj Graph11): row boundaries
      // vary per-pair (0 = flush shared-x "wall" seam, GRID_GAP otherwise) —
      // CSS Grid's `gap` is one uniform value, so the grid switched to
      // explicit pixel placement (`panelLayout`'s column/row math +
      // cumulative offsets) instead of `gridTemplateRows`/`gridTemplateColumns`
      // auto-sizing. Columns stay uniformly spaced (unchanged).
      const colW = columnWidths(grid.cols, w, GRID_GAP);
      const rowGaps = rowBoundaryGaps(panels, grid.rows, GRID_GAP);
      const rowH = rowHeights(grid.rows, h, rowGaps);
      const colLefts = cumulativeOffsets(colW, GRID_GAP);
      const rowTops = cumulativeOffsets(rowH, rowGaps);
      const suppressed = suppressedXIndices(panels);
      const divs: HTMLDivElement[] = [];
      panels.forEach((p, i) => {
        const entry = spatialPayloads[i];
        if (!entry) return;
        const { payload: pp, errorBars } = entry;
        const div = document.createElement("div");
        div.style.position = "absolute";
        div.style.left = `${colLefts[p.col]}px`;
        div.style.top = `${rowTops[p.row]}px`;
        div.style.width = `${colW[p.col]}px`;
        div.style.height = `${rowH[p.row]}px`;
        host.appendChild(div);
        divs.push(div);
        // Item A: styles/labels line up with the SAME hidden-filtered channel
        // order the payload was fetched in (`spatialPlottedChannels`), not
        // the raw `p.yKeys` (which still includes a dropped error column).
        const plottedChannels = spatialPlottedChannels(p);
        const cellStyles = plottedChannels.map((ch) => p.seriesStyles?.[ch]);
        const cellLabels = plottedChannels.map((ch) => p.seriesLabels?.[ch]);
        const opts = buildOpts(pp, {
          width: colW[p.col],
          height: rowH[p.row],
          yLog: p.yLog,
          xLog: p.xLog,
          xLim: p.xLim,
          yLim: p.yLim,
          xStep: p.xStep,
          yStep: p.yStep,
          // This panel's OWN merged y2 overlay, when one was paired in
          // (decode-plan #36 residual) — mirrors the single-plot double-Y
          // apply's y2Lim/y2Log/y2Step/y2AxisLabel, scoped to this cell.
          y2Lim: p.y2Lim ?? null,
          y2Log: p.y2Log ?? null,
          y2Step: p.y2Step ?? null,
          y2AxisLabel: p.y2AxisLabel,
          xFmt,
          yFmt,
          showGrid,
          axisBox: showAxisBox,
          tool,
          onReadout: setReadout,
          seriesStyles: cellStyles,
          seriesLabels: cellLabels,
          // Item A (PNR.opj Book14 Graph11 repro): draw whiskers for this
          // panel's Y-error-designated columns instead of the multi-panel
          // path silently rendering them (or, pre-fix, nothing at all).
          errorBars,
          // Item B: faithful per-layer x title (null = Origin decoded an
          // explicitly blank title — force blank, never synthesize).
          xAxisLabel: p.xAxisLabel,
          yAxisLabel: p.yAxisLabel,
          // Each panel's OWN layer's floating text (fix #5 — a multi-panel
          // apply used to drop every layer's annotations).
          annotations: p.annotations,
          linearPaths: LINEAR_PATHS,
          pointsPaths: POINTS_PATHS,
        });
        opts.cursor = { ...opts.cursor, sync: { key: SYNC_KEY } };
        // Item B: blank x tick values + title on every panel with a flush
        // shared-x neighbor directly below it (only the run's bottom panel
        // keeps them) — same idiom the plain per-channel stack mode already
        // uses for its own bottom-panel-only x labels.
        if (suppressed.has(i) && opts.axes?.[0]) {
          opts.axes[0] = { ...opts.axes[0], label: undefined, values: (_u, splits) => splits.map(() => "") };
        }
        plotsRef.current.push(new uPlot(opts, pp.data, div));
      });
      const ro = new ResizeObserver(() => {
        const width = host.clientWidth || w;
        const height = host.clientHeight || h;
        const cw = columnWidths(grid.cols, width, GRID_GAP);
        const rg = rowBoundaryGaps(panels, grid.rows, GRID_GAP);
        const rh = rowHeights(grid.rows, height, rg);
        const cl = cumulativeOffsets(cw, GRID_GAP);
        const rt = cumulativeOffsets(rh, rg);
        panels.forEach((p, idx) => {
          const div = divs[idx];
          const u = plotsRef.current[idx];
          if (!div || !u) return;
          div.style.left = `${cl[p.col]}px`;
          div.style.top = `${rt[p.row]}px`;
          div.style.width = `${cw[p.col]}px`;
          div.style.height = `${rh[p.row]}px`;
          u.setSize({ width: cw[p.col], height: rh[p.row] });
        });
      });
      ro.observe(host);
      return () => {
        ro.disconnect();
        destroyAll();
      };
    }

    if (breakMode) {
      const bPanels = breakPanels ?? [];
      if (bPanels.length === 0) {
        destroyAll();
        return;
      }
      destroyAll();
      host.replaceChildren();
      const w = host.clientWidth || 600;
      const h = host.clientHeight || 400;
      const widths = breakPanelWidths(bPanels.length, w, BREAK_GLYPH_W);
      // Same x-zoom/pan sync idiom as the plain per-channel stack — a break
      // panel's x axis still means "this series' x", so zooming one seam
      // should pan/zoom the others together.
      const onSetScale = xZoomSyncHook(() => plotsRef.current);
      bPanels.forEach((p, i) => {
        if (i > 0) host.appendChild(makeBreakGlyph(BREAK_GLYPH_W));
        const div = document.createElement("div");
        div.style.flex = `0 0 ${widths[i]}px`;
        host.appendChild(div);
        const opts = buildOpts(p.payload, {
          width: widths[i],
          height: h,
          yLog,
          xLog,
          xLim: p.xRange,
          yLim: breakYLim,
          xFmt,
          yFmt,
          showGrid,
          axisBox: showAxisBox,
          tool,
          onReadout: setReadout,
          linearPaths: LINEAR_PATHS,
          pointsPaths: POINTS_PATHS,
        });
        opts.cursor = { ...opts.cursor, sync: { key: SYNC_KEY } };
        opts.hooks = { setScale: [onSetScale] };
        plotsRef.current.push(new uPlot(opts, p.payload.data, div));
      });
      const ro = new ResizeObserver(() => {
        const width = host.clientWidth || w;
        const height = host.clientHeight || h;
        const ws = breakPanelWidths(bPanels.length, width, BREAK_GLYPH_W);
        plotsRef.current.forEach((u, idx) => u.setSize({ width: ws[idx], height }));
      });
      ro.observe(host);
      return () => {
        ro.disconnect();
        destroyAll();
      };
    }

    if (facet) {
      const fPanels = facetPanels ?? [];
      if (fPanels.length === 0) {
        destroyAll();
        return;
      }
      destroyAll();
      host.replaceChildren();
      const w = host.clientWidth || 600;
      const h = host.clientHeight || 400;
      const { cellW, cellH } = cellSize(w, h, facetGrid, GRID_GAP);
      // Same x-zoom/pan sync idiom as the plain per-channel stack below (one
      // shared hook instance for the whole panel set — the x axis means the
      // same thing in every facet panel too).
      const onSetScale = xZoomSyncHook(() => plotsRef.current);
      fPanels.forEach((p) => {
        const div = document.createElement("div");
        host.appendChild(div);
        const opts = buildOpts(p.payload, {
          width: cellW,
          height: cellH,
          yLog,
          xLog,
          xLim: facetXLim,
          xFmt,
          yFmt,
          showGrid,
          axisBox: showAxisBox,
          tool,
          onReadout: setReadout,
          title: p.label,
          linearPaths: LINEAR_PATHS,
          pointsPaths: POINTS_PATHS,
        });
        opts.cursor = { ...opts.cursor, sync: { key: SYNC_KEY } };
        opts.hooks = { setScale: [onSetScale] };
        plotsRef.current.push(new uPlot(opts, p.payload.data, div));
      });
      const ro = new ResizeObserver(() => {
        const width = host.clientWidth || w;
        const height = host.clientHeight || h;
        const { cellW: cw, cellH: ch } = cellSize(width, height, facetGrid, GRID_GAP);
        plotsRef.current.forEach((u) => u.setSize({ width: cw, height: ch }));
      });
      ro.observe(host);
      return () => {
        ro.disconnect();
        destroyAll();
      };
    }

    if (!payload) {
      destroyAll();
      return;
    }
    destroyAll();
    host.replaceChildren();

    const stackedPanels = splitPayload(payload);
    const w = host.clientWidth || 600;
    const heights = panelHeights(stackedPanels.length, host.clientHeight || 400);
    // Propagate an x-zoom on one panel to all the others.
    const onSetScale = xZoomSyncHook(() => plotsRef.current);

    stackedPanels.forEach((pp, i) => {
      const div = document.createElement("div");
      host.appendChild(div);
      const opts = buildOpts(pp, {
        width: w,
        height: heights[i],
        yLog,
        xLog,
        xLim,
        xFmt,
        yFmt,
        showGrid,
        axisBox: showAxisBox,
        refLines,
        tool,
        onReadout: setReadout,
        seriesStyles: styleList ? [styleList[i]] : undefined,
        // Item A: same class of fix as the spatial multi-panel path — an
        // Origin "Y-error" column is already dropped from `plotted` above, so
        // its paired Y channel's own panel draws whiskers instead.
        errorBars: errorBarsList[i],
        linearPaths: LINEAR_PATHS,
        pointsPaths: POINTS_PATHS,
      });
      opts.cursor = { ...opts.cursor, sync: { key: SYNC_KEY } };
      opts.hooks = { setScale: [onSetScale] };
      // Blank the x tick labels on every panel but the bottom (keep the axis so
      // the plot areas stay the same width and the panels line up).
      const isBottom = i === stackedPanels.length - 1;
      if (!isBottom && opts.axes?.[0]) {
        opts.axes[0] = { ...opts.axes[0], label: undefined, values: (_u, splits) => splits.map(() => "") };
      }
      plotsRef.current.push(new uPlot(opts, pp.data, div));
    });

    const ro = new ResizeObserver(() => {
      const hs = panelHeights(plotsRef.current.length, host.clientHeight || 400);
      const width = host.clientWidth || w;
      plotsRef.current.forEach((u, idx) => u.setSize({ width, height: hs[idx] }));
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      destroyAll();
    };
  }, [
    spatial,
    spatialPayloads,
    panels,
    grid,
    breakMode,
    breakPanels,
    breakYLim,
    facet,
    facetPanels,
    facetGrid,
    facetXLim,
    payload,
    yLog,
    xLog,
    xLim,
    xFmt,
    yFmt,
    showGrid,
    showAxisBox,
    refLines,
    styleList,
    errorBarsList,
    tool,
    theme,
    accent,
  ]);

  const hostStyle: CSSProperties = spatial
    ? // Item B: children are now explicitly pixel-positioned (`panelLayout`'s
      // column/row math), not CSS Grid `1fr` auto-sizing — CSS Grid's `gap`
      // is one uniform value and can't express a flush (0px) row boundary
      // next to a normal one. `position: absolute` here still establishes
      // the containing block the child divs' own `position: absolute`
      // resolves against.
      { position: "absolute", inset: 8 }
    : breakMode
      ? { position: "absolute", inset: 8, display: "flex", flexDirection: "row" }
      : facet
        ? {
            position: "absolute",
            inset: 8,
            display: "grid",
            gap: GRID_GAP,
            gridTemplateRows: `repeat(${facetGrid.rows}, 1fr)`,
            gridTemplateColumns: `repeat(${facetGrid.cols}, 1fr)`,
          }
        : { position: "absolute", inset: 8, display: "flex", flexDirection: "column", gap: 8 };

  return { hostRef, hostStyle, readout, tool };
}
