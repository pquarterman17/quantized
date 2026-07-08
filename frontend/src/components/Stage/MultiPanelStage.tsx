// Multi-panel plot, two modes sharing one host:
//  1) Plain per-channel stack: each plotted channel of the ACTIVE dataset
//     gets its own vertically-stacked uPlot panel sharing the x-axis.
//     Box-zoom/pan on any panel syncs the x-range to the others (setScale
//     hook), and the cursor crosshair syncs via uPlot's sync group. Only the
//     bottom panel shows x tick labels so the panels align.
//  2) Spatial multi-panel (decode-plan #36): `store.spatialPanels`, set by
//     `applyOriginFigure` when a multi-layer Origin figure's layers all
//     resolve, arranges EACH panel's OWN dataset + channel selection + fixed
//     axis state in a CSS grid per the source page's layout
//     (`lib/originPanels.computePanelLayout`). Panels are independent — no
//     x-sync, since they may plot entirely unrelated datasets/quantities.
// Self-contained — fetches its own series; overlays/waterfall stay single-view.

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import "uplot/dist/uPlot.min.css";

import { effectiveChannels, fetchPlot, type PlotPayload } from "../../lib/plotdata";
import { panelHeights, spatialGridSize, splitPayload } from "../../lib/multipanel";
import { buildOpts } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotTools";
import { useActiveDataset, useApp } from "../../store/useApp";

const SYNC_KEY = "qz-multipanel";
const GRID_GAP = 8;

export default function MultiPanelStage() {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const rawSpatialPanels = useApp((s) => s.spatialPanels);
  const yLog = useApp((s) => s.yLog);
  const xLog = useApp((s) => s.xLog);
  const xLim = useApp((s) => s.xLim);
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
  const setStackMode = useApp((s) => s.setStackMode);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotsRef = useRef<uPlot[]>([]);
  const [payload, setPayload] = useState<PlotPayload | null>(null);
  const [spatialPayloads, setSpatialPayloads] = useState<(PlotPayload | null)[]>([]);
  const [readout, setReadout] = useState<Readout | null>(null);

  // Spatial panels whose dataset still exists (a removed dataset degrades to
  // dropping that one cell, never a crash). Stable reference when unchanged.
  const panels = useMemo(
    () => (rawSpatialPanels ?? []).filter((p) => datasets.some((d) => d.id === p.datasetId)),
    [rawSpatialPanels, datasets],
  );
  const spatial = panels.length > 0;
  const grid = useMemo(() => spatialGridSize(panels), [panels]);

  // Channels actually drawn (y selection minus the x-axis channel), in order
  // — the plain per-channel stack mode only.
  const plotted = useMemo(
    () =>
      !spatial && active
        ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder)
        : [],
    [spatial, active, yKeys, xKey, seriesOrder],
  );
  const styleList = useMemo(() => plotted.map((ch) => seriesStyles[ch]), [plotted, seriesStyles]);

  useEffect(() => {
    let cancelled = false;
    if (spatial || !active) {
      setPayload(null);
      return;
    }
    fetchPlot(active.data, yLog, xLog, plotted, y2Keys, xKey).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [spatial, active, yLog, xLog, plotted, y2Keys, xKey]);

  useEffect(() => {
    let cancelled = false;
    if (!spatial) {
      setSpatialPayloads([]);
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
      const cellW = Math.max(1, Math.floor((w - (grid.cols - 1) * GRID_GAP) / grid.cols));
      const cellH = Math.max(1, Math.floor((h - (grid.rows - 1) * GRID_GAP) / grid.rows));
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
        const cw = Math.max(1, Math.floor((width - (grid.cols - 1) * GRID_GAP) / grid.cols));
        const ch = Math.max(1, Math.floor((height - (grid.rows - 1) * GRID_GAP) / grid.rows));
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
    let syncing = false;

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
      // Propagate an x-zoom on one panel to all the others.
      opts.hooks = {
        setScale: [
          (u: uPlot, key: string) => {
            if (key !== "x" || syncing) return;
            const { min, max } = u.scales.x;
            if (min == null || max == null) return;
            syncing = true;
            for (const other of plotsRef.current) {
              if (other !== u) other.setScale("x", { min, max });
            }
            syncing = false;
          },
        ],
      };
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

  return (
    <div className="qzk-stage">
      <div
        ref={hostRef}
        style={
          spatial
            ? {
                position: "absolute",
                inset: 8,
                display: "grid",
                gap: GRID_GAP,
                gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
                gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
              }
            : { position: "absolute", inset: 8, display: "flex", flexDirection: "column", gap: 8 }
        }
      />
      <div className="qzk-glass qzk-float-tools">
        <button
          className="qzk-tool-btn active"
          title="Back to a single overlaid plot"
          onClick={() => setStackMode(false)}
        >
          ▤
        </button>
      </div>
      {tool === "cursor" && readout && (
        <div className="qzk-glass qzk-readout">
          <div style={{ color: "var(--text-dim)" }}>x = {readout.x.toPrecision(5)}</div>
          {readout.rows.map((r, i) => (
            <div key={`${r.label}-${i}`} style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
              <span>{r.label || "y"}</span>
              <span>{r.y.toPrecision(5)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
