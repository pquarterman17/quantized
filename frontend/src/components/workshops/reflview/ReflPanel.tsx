// One frame of the reflectometry view: a self-contained uPlot built from a
// PlotPayload via the shared buildOpts. Re-creates on payload/scale/theme change
// and tracks its container size. Used twice (reflectivity + SLD profile).

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import { LINEAR_PATHS, POINTS_PATHS } from "../../../lib/uplotPaths";
import "uplot/dist/uPlot.min.css";

import type { PlotPayload } from "../../../lib/plotdata";
import { buildOpts } from "../../../lib/uplotOpts";
import { useApp } from "../../../store/useApp";

interface Props {
  payload: PlotPayload;
  yLog: boolean;
  height: number;
  label: string;
}

export default function ReflPanel({ payload, yLog, height, label }: Props) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    plotRef.current?.destroy();
    const w = host.clientWidth || 420;
    const opts = buildOpts(payload, {
      width: w,
      height,
      yLog,
      xLog: false,
      showGrid: true,
      tool: "zoom",
      onReadout: () => {},
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
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
  }, [payload, yLog, height, theme, accent]);

  return <div ref={hostRef} style={{ width: "100%", height }} aria-label={label} />;
}
