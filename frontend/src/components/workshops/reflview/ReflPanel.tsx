// One frame of the reflectometry view: a self-contained uPlot built from a
// PlotPayload via the shared buildOpts. Re-creates on payload/scale/theme change
// and tracks its container size. Used twice (reflectivity + SLD profile).
// buildOpts hides uPlot's own legend (the stage draws its own), so this frame
// lists its series under the plot -- otherwise R, theory and fresnel (or rho,
// irho and rhoM) were indistinguishable lines.

import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import { LINEAR_PATHS, POINTS_PATHS } from "../../../lib/uplotPaths";
import "uplot/dist/uPlot.min.css";

import type { PlotPayload } from "../../../lib/plotdata";
import type { SeriesStyle } from "../../../lib/seriesStyleTypes";
import { buildOpts } from "../../../lib/uplotOpts";
import { useApp } from "../../../store/useApp";

interface Props {
  payload: PlotPayload;
  yLog: boolean;
  height: number;
  label: string;
  /** Y-axis title (a multi-series frame otherwise has none). */
  yLabel?: string;
  /** Vertical error bars keyed by uPlot data column (1-based). */
  errorBars?: Map<number, (number | null)[]> | null;
  /** Per-series styles, aligned with `payload.series`. */
  seriesStyles?: readonly SeriesStyle[];
}

export default function ReflPanel({ payload, yLog, height, label, yLabel, errorBars, seriesStyles }: Props) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [colors, setColors] = useState<string[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    plotRef.current?.destroy();
    const w = host.clientWidth || 420;
    const opts = buildOpts(payload, {
      width: w,
      height,
      yScale: yLog ? "log" : "linear",
      xScale: "linear",
      showGrid: true,
      tool: "zoom",
      onReadout: () => {},
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
      yAxisLabel: yLabel,
      errorBars: errorBars ?? undefined,
      seriesStyles: seriesStyles ? [...seriesStyles] : undefined,
    });
    setColors(opts.series.slice(1).map((s) => (typeof s.stroke === "string" ? s.stroke : "")));
    plotRef.current = new uPlot(opts, payload.data, host);
    const ro = new ResizeObserver(() =>
      plotRef.current?.setSize({ width: host.clientWidth || w, height }),
    );
    ro.observe(host);
    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [payload, yLog, height, theme, accent, yLabel, errorBars, seriesStyles]);

  return (
    <div>
      <div ref={hostRef} style={{ width: "100%", height }} aria-label={label} />
      <div className="qzk-ds-meta" style={{ display: "flex", gap: 10, flexWrap: "wrap" }} aria-label={`${label} legend`}>
        {payload.series.map((s, i) => (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 12, height: 2, background: colors[i] || "currentColor" }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
