// The hero canvas: a uPlot instance wired to the active dataset via the
// backend /api/plot/series route (offline fallback builds columns locally).
// Re-styles on theme/accent change; resizes to its container.

import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { fetchPlot, type PlotPayload } from "../../lib/plotdata";
import { buildOpts } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotPlugins";
import { useActiveDataset, useApp } from "../../store/useApp";

const TOOLS = [
  { id: "zoom", glyph: "⛶", tip: "Box zoom" },
  { id: "pan", glyph: "✥", tip: "Pan" },
  { id: "cursor", glyph: "✛", tip: "Data cursor" },
] as const;

export default function PlotStage() {
  const active = useActiveDataset();
  const yLog = useApp((s) => s.yLog);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [payload, setPayload] = useState<PlotPayload | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  // Fetch series whenever the active dataset or y-scale changes.
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setPayload(null);
      return;
    }
    fetchPlot(active.data, yLog).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [active, yLog]);

  // (Re)create the uPlot instance when payload / size / theme change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !payload) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }
    const w = host.clientWidth || 600;
    const h = host.clientHeight || 400;
    plotRef.current?.destroy();
    plotRef.current = new uPlot(
      buildOpts(payload, {
        width: w,
        height: h,
        yLog,
        tool,
        onReadout: setReadout,
      }),
      payload.data,
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
  }, [payload, yLog, theme, accent, tool]);

  function resetView() {
    if (plotRef.current && payload) {
      plotRef.current.setData(payload.data, true); // resetScales = re-fit
    }
  }

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }} />

      {payload && (
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
      {payload && (
        <div className="qzk-glass qzk-legend">
          {payload.series.map((s, i) => (
            <div className="it" key={s.label}>
              <span
                className="ln"
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 2,
                  background: `var(--series-${(i % 8) + 1})`,
                }}
              />
              {s.unit ? `${s.label} (${s.unit})` : s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
