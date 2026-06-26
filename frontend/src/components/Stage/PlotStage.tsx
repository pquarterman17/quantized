// The hero canvas: a uPlot instance wired to the active dataset via the
// backend /api/plot/series route (offline fallback builds columns locally).
// Re-styles on theme/accent change; resizes to its container.

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import {
  applyWaterfall,
  fetchPlot,
  withBaselineOverlay,
  withFitOverlay,
  withPeakOverlay,
  type PlotPayload,
} from "../../lib/plotdata";
import { exportPlotPng } from "../../lib/plotExport";
import { buildOpts } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotPlugins";
import { useActiveDataset, useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";

const TOOLS = [
  { id: "zoom", glyph: "⛶", tip: "Box zoom" },
  { id: "pan", glyph: "✥", tip: "Pan" },
  { id: "cursor", glyph: "✛", tip: "Data cursor" },
] as const;

export default function PlotStage() {
  const active = useActiveDataset();
  const yLog = useApp((s) => s.yLog);
  const xLog = useApp((s) => s.xLog);
  const xLim = useApp((s) => s.xLim);
  const yLim = useApp((s) => s.yLim);
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const showGrid = useApp((s) => s.showGrid);
  const showLegend = useApp((s) => s.showLegend);
  const refLines = useApp((s) => s.refLines);
  const annotations = useApp((s) => s.annotations);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const waterfall = useApp((s) => s.waterfall);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const stackMode = useApp((s) => s.stackMode);
  const setStackMode = useApp((s) => s.setStackMode);
  const fitOverlay = useApp((s) => s.fitOverlay);
  const peakOverlay = useApp((s) => s.peakOverlay);
  const baselineOverlay = useApp((s) => s.baselineOverlay);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [payload, setPayload] = useState<PlotPayload | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  // Splice in the fit curve + peak markers (each a no-op unless it belongs to
  // the active dataset and aligns to the plotted x).
  const displayPayload = useMemo(() => {
    if (!payload) return null;
    const id = active?.id ?? null;
    // Waterfall offsets the channels first (channel 0 stays put), then overlays
    // (fit/peak/baseline target channel 0) land in register on top.
    const base = applyWaterfall(payload, waterfall);
    const withFit = withFitOverlay(base, fitOverlay, id);
    const withBase = withBaselineOverlay(withFit, baselineOverlay, id);
    return withPeakOverlay(withBase, peakOverlay, id);
  }, [payload, fitOverlay, peakOverlay, baselineOverlay, waterfall, active]);

  // Map each display-series back to its dataset channel so the per-channel style
  // overrides land on the right line. Plotted channels come first (in yKeys order,
  // matching the backend), overlays after — those get `undefined` (defaults).
  const styleList = useMemo(() => {
    if (!displayPayload || !active) return undefined;
    const plotted = yKeys ?? active.data.labels.map((_, i) => i);
    return displayPayload.series.map((_, i) =>
      i < plotted.length ? seriesStyles[plotted[i]] : undefined,
    );
  }, [displayPayload, active, yKeys, seriesStyles]);

  // Fetch series whenever the active dataset or y-scale changes.
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

  // (Re)create the uPlot instance when payload / size / theme change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !displayPayload) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }
    const w = host.clientWidth || 600;
    const h = host.clientHeight || 400;
    plotRef.current?.destroy();
    plotRef.current = new uPlot(
      buildOpts(displayPayload, {
        width: w,
        height: h,
        yLog,
        xLog,
        xLim,
        yLim,
        xFmt,
        yFmt,
        showGrid,
        refLines,
        annotations,
        seriesStyles: styleList,
        tool,
        onReadout: setReadout,
      }),
      displayPayload.data,
      host,
    );

    const ro = new ResizeObserver(() => {
      plotRef.current?.setSize({
        width: host.clientWidth || w,
        height: host.clientHeight || h,
      });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // theme/accent in deps so the plot recolors from fresh tokens; tool rebuilds
    // the cursor/drag config + plugins.
  }, [displayPayload, yLog, xLog, xLim, yLim, xFmt, yFmt, showGrid, refLines, annotations, styleList, theme, accent, tool]);

  function resetView() {
    if (plotRef.current && displayPayload) {
      plotRef.current.setData(displayPayload.data, true); // resetScales = re-fit
    }
  }

  function savePng() {
    if (!plotRef.current) return;
    const stem = active?.name.replace(/\.[^.]+$/, "") ?? "plot";
    exportPlotPng(plotRef.current, `${stem}.png`);
  }

  // Stacked multi-panel view (one panel per channel) when enabled + ≥2 channels.
  const nPlotted = yKeys?.length ?? active?.data.labels.length ?? 0;
  if (stackMode && nPlotted >= 2) return <MultiPanelStage />;

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }} />

      {displayPayload && (
        <div className="qzk-glass qzk-float-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`qzk-tool-btn${tool === t.id ? " active" : ""}`}
              title={t.tip}
              onClick={() => setPlotTool(t.id)}
            >
              {t.glyph}
            </button>
          ))}
          <span className="qzk-tool-sep" />
          <button className="qzk-tool-btn" title="Reset view" onClick={resetView}>
            ⊡
          </button>
          <button className="qzk-tool-btn" title="Save plot as PNG" onClick={savePng}>
            ⤓
          </button>
          <span className="qzk-tool-sep" />
          <button
            className={`qzk-tool-btn${stackMode ? " active" : ""}`}
            title="Stack channels in separate panels"
            onClick={() => setStackMode(true)}
          >
            ▤
          </button>
        </div>
      )}

      {!active && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
        >
          Select a dataset to plot
        </div>
      )}

      {tool === "cursor" && readout && (
        <div className="qzk-glass qzk-readout">
          {readout.x.toPrecision(5)}, {readout.y.toPrecision(5)}
        </div>
      )}
      {displayPayload && showLegend && (
        <div className="qzk-glass qzk-legend">
          {displayPayload.series.map((s, i) => {
            // Keep the CSS token for default series (re-themes); use the resolved
            // override color when one is set, so the legend matches the line.
            const override = styleList?.[i]?.color;
            const swatch =
              override && !override.startsWith("--")
                ? override
                : override
                  ? `var(${override})`
                  : `var(--series-${(i % 8) + 1})`;
            return (
              <div className="it" key={s.label}>
                <span
                  className="ln"
                  style={{ display: "inline-block", width: 14, height: 2, background: swatch }}
                />
                {s.unit ? `${s.label} (${s.unit})` : s.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
