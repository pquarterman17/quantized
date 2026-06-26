// Multi-panel (stacked) plot: each plotted channel gets its own vertically-
// stacked uPlot panel sharing the x-axis. Box-zoom / pan on any panel syncs the
// x-range to the others (setScale hook), and the cursor crosshair syncs via
// uPlot's sync group. Only the bottom panel shows x tick labels so the panels
// align. Self-contained — fetches the same series as PlotStage; overlays /
// waterfall stay single-view only.

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { fetchPlot, type PlotPayload } from "../../lib/plotdata";
import { panelHeights, splitPayload } from "../../lib/multipanel";
import { buildOpts } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotPlugins";
import { useActiveDataset, useApp } from "../../store/useApp";

const SYNC_KEY = "qz-multipanel";

export default function MultiPanelStage() {
  const active = useActiveDataset();
  const yLog = useApp((s) => s.yLog);
  const xLog = useApp((s) => s.xLog);
  const xLim = useApp((s) => s.xLim);
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const showGrid = useApp((s) => s.showGrid);
  const refLines = useApp((s) => s.refLines);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const tool = useApp((s) => s.plotTool);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setStackMode = useApp((s) => s.setStackMode);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotsRef = useRef<uPlot[]>([]);
  const [payload, setPayload] = useState<PlotPayload | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  // Per-panel style, mapped from the plotted channel (yKeys order) to its override.
  const styleList = useMemo(() => {
    if (!active) return undefined;
    const plotted = yKeys ?? active.data.labels.map((_, i) => i);
    return plotted.map((ch) => seriesStyles[ch]);
  }, [active, yKeys, seriesStyles]);

  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setPayload(null);
      return;
    }
    fetchPlot(active.data, yLog, xLog, yKeys, y2Keys).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [active, yLog, xLog, yKeys, y2Keys]);

  useEffect(() => {
    const host = hostRef.current;
    const destroyAll = () => {
      plotsRef.current.forEach((p) => p.destroy());
      plotsRef.current = [];
    };
    if (!host || !payload) {
      destroyAll();
      return;
    }
    destroyAll();
    host.replaceChildren();

    const panels = splitPayload(payload);
    const w = host.clientWidth || 600;
    const heights = panelHeights(panels.length, host.clientHeight || 400);
    let syncing = false;

    panels.forEach((pp, i) => {
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
      const isBottom = i === panels.length - 1;
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
  }, [payload, yLog, xLog, xLim, xFmt, yFmt, showGrid, refLines, styleList, tool, theme, accent]);

  return (
    <div className="qzk-stage">
      <div
        ref={hostRef}
        style={{ position: "absolute", inset: 8, display: "flex", flexDirection: "column", gap: 8 }}
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
          {readout.x.toPrecision(5)}, {readout.y.toPrecision(5)}
        </div>
      )}
    </div>
  );
}
