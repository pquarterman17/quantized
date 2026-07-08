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

import { sharedXDomain, sharedYDomain } from "../../lib/facet";
import { effectiveChannels, fetchPlot, type PlotPayload } from "../../lib/plotdata";
import {
  breakPanelWidths,
  cellSize,
  facetGridSize,
  panelHeights,
  spatialGridSize,
  splitPayload,
  xZoomSyncHook,
} from "../../lib/multipanel";
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
  const refLines = useApp((s) => s.refLines);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const tool = useApp((s) => s.plotTool);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotsRef = useRef<uPlot[]>([]);
  const [payload, setPayload] = useState<PlotPayload | null>(null);
  const [spatialPayloads, setSpatialPayloads] = useState<(PlotPayload | null)[]>([]);
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
        ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder)
        : [],
    [spatial, facet, breakMode, active, yKeys, xKey, seriesOrder],
  );
  const styleList = useMemo(() => plotted.map((ch) => seriesStyles[ch]), [plotted, seriesStyles]);

  useEffect(() => {
    let cancelled = false;
    if (spatial || facet || breakMode || !active) {
      setPayload(null);
      return;
    }
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
        return ds ? fetchPlot(ds.data, p.yLog, p.xLog, p.yKeys, null, p.xKey) : Promise.resolve(null);
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
      const { cellW, cellH } = cellSize(w, h, grid, GRID_GAP);
      panels.forEach((p, i) => {
        const pp = spatialPayloads[i];
        if (!pp) return;
        const div = document.createElement("div");
        div.style.gridRow = `${p.row + 1}`;
        div.style.gridColumn = `${p.col + 1}`;
        host.appendChild(div);
        const cellStyles = p.yKeys.map((ch) => p.seriesStyles?.[ch]);
        const opts = buildOpts(pp, {
          width: cellW,
          height: cellH,
          yLog: p.yLog,
          xLog: p.xLog,
          xLim: p.xLim,
          yLim: p.yLim,
          xFmt,
          yFmt,
          showGrid,
          tool,
          onReadout: setReadout,
          seriesStyles: cellStyles,
          xAxisLabel: p.xAxisLabel,
          yAxisLabel: p.yAxisLabel,
          linearPaths: LINEAR_PATHS,
          pointsPaths: POINTS_PATHS,
        });
        opts.cursor = { ...opts.cursor, sync: { key: SYNC_KEY } };
        plotsRef.current.push(new uPlot(opts, pp.data, div));
      });
      const ro = new ResizeObserver(() => {
        const width = host.clientWidth || w;
        const height = host.clientHeight || h;
        const { cellW: cw, cellH: ch } = cellSize(width, height, grid, GRID_GAP);
        plotsRef.current.forEach((u) => u.setSize({ width: cw, height: ch }));
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
        refLines,
        tool,
        onReadout: setReadout,
        seriesStyles: styleList ? [styleList[i]] : undefined,
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
    refLines,
    styleList,
    tool,
    theme,
    accent,
  ]);

  const hostStyle: CSSProperties = spatial
    ? {
        position: "absolute",
        inset: 8,
        display: "grid",
        gap: GRID_GAP,
        gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
      }
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
