// Waterfall workshop — a draggable ToolWindow that stacks one channel across the
// chosen datasets and exports a consolidated CSV with or without the offset baked
// in. Renders its own uPlot (reuses buildOpts via a synthesized PlotPayload).

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import { LINEAR_PATHS, POINTS_PATHS } from "../../../lib/uplotPaths";
import "uplot/dist/uPlot.min.css";

import { useWaterfall } from "./useWaterfall";
import type { PlotPayload } from "../../../lib/plotdata";
import { buildOpts } from "../../../lib/uplotOpts";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";

export default function WaterfallView() {
  const close = useApp((s) => s.setWaterfallOpen);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const w = useWaterfall();
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const canPlot = w.count >= 1 && !!w.channel && w.aligned.x.length > 0;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canPlot) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }
    plotRef.current?.destroy();
    const payload: PlotPayload = {
      data: [w.aligned.x, ...w.aligned.ys] as uPlot.AlignedData,
      series: w.traceLabels.map((label) => ({ label, unit: "" })),
      xLabel: "x",
      xUnit: "",
    };
    const width = host.clientWidth || 380;
    const height = host.clientHeight || 280;
    const opts = buildOpts(payload, {
      width,
      height,
      yLog: w.logY,
      xLog: false,
      showGrid: true,
      tool: "zoom",
      onReadout: () => {},
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    plotRef.current = new uPlot(opts, payload.data, host);
    const ro = new ResizeObserver(() =>
      plotRef.current?.setSize({ width: host.clientWidth || width, height: host.clientHeight || height }),
    );
    ro.observe(host);
    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [w.aligned, w.traceLabels, w.logY, theme, accent, canPlot]);

  return (
    <ToolWindow title="Waterfall" x={140} y={80} width={460} onClose={() => close(false)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="qzk-ds-meta">
          Stack one channel across datasets. Defaults to your selection; tick rows to include.
        </div>

        {/* Included datasets */}
        <div className="qzk-wf-list">
          {w.datasets.map((d) => (
            <label key={d.id} className="qz-check" title={d.name}>
              <input
                type="checkbox"
                checked={d.included}
                onChange={(e) => w.setIncluded(d.id, e.target.checked)}
              />
              <span className="qzk-wf-name">{d.name}</span>
            </label>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="qzk-field">
            <span>Channel</span>
            <select
              className="qz-input"
              value={w.channel}
              onChange={(e) => w.setChannel(e.target.value)}
              disabled={w.channels.length === 0}
            >
              {w.channels.length === 0 && <option value="">— no shared channel —</option>}
              {w.channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="qzk-field">
            <span>Offset</span>
            <select
              className="qz-input"
              value={w.mode}
              onChange={(e) => w.setMode(e.target.value as "add" | "mul")}
            >
              <option value="add">Additive (+)</option>
              <option value="mul">Multiplicative (×, for log)</option>
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label className="qz-check">
            <input type="checkbox" checked={w.autoSpace} onChange={(e) => w.setAutoSpace(e.target.checked)} />
            Auto spacing
          </label>
          <label className="qzk-field">
            <span>Spacing</span>
            <input
              className="qz-input"
              type="number"
              style={{ width: 90 }}
              value={w.autoSpace ? Number(w.spacing.toPrecision(4)) : w.manualSpacing}
              disabled={w.autoSpace}
              onChange={(e) => w.setManualSpacing(Number(e.target.value))}
            />
          </label>
          <label className="qz-check">
            <input type="checkbox" checked={w.reverse} onChange={(e) => w.setReverse(e.target.checked)} />
            Reverse
          </label>
          <label className="qz-check">
            <input type="checkbox" checked={w.logY} onChange={(e) => w.setLogY(e.target.checked)} />
            Log Y
          </label>
        </div>

        {/* Plot */}
        {canPlot ? (
          <div ref={hostRef} style={{ width: "100%", height: 280 }} />
        ) : (
          <div className="qzk-ds-meta" style={{ height: 280, display: "grid", placeItems: "center" }}>
            {w.count === 0
              ? "Include at least one dataset"
              : w.channels.length === 0
                ? "The included datasets share no common channel"
                : "Nothing to plot"}
          </div>
        )}

        {/* Export */}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="qz-btn" disabled={!canPlot} onClick={() => w.exportCSV(true)}>
            Export CSV (with offset)
          </button>
          <button className="qz-btn" disabled={!canPlot} onClick={() => w.exportCSV(false)}>
            Export CSV (raw)
          </button>
        </div>
      </div>
    </ToolWindow>
  );
}
