// Reflectivity fit — the linked data/model/residual/SLD view (P2.2). Three
// small uPlots from reflFitResiduals.ts' payloads: data + model on a log-R
// axis, the residuals under it on the SAME Q column (zero line drawn; a Q zoom
// in either panel zooms both, and the cursor is shared), and the SLD depth
// profile beside them on its own z axis. Shown for the live fit and for a
// saved fit, which stores its residuals with its curves.

import { useEffect, useId, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { PlotPayload } from "../../../lib/plotdata";
import type { RefLine } from "../../../lib/types";
import { buildOpts } from "../../../lib/uplotOpts";
import { LINEAR_PATHS, POINTS_PATHS } from "../../../lib/uplotPaths";
import { useApp } from "../../../store/useApp";
import type { CurvesLike } from "./reflFitCurves";
import type { Weighting } from "./reflFitData";
import { fitPlotPanels, linkX, RESIDUAL_MEANING } from "./reflFitResiduals";

const ZERO: RefLine[] = [{ id: "zero", axis: "y", value: 0 }];
const NOTE = { color: "var(--text-faint)" } as const;

interface PlotProps {
  payload: PlotPayload;
  label: string;
  height: number;
  yLog?: boolean;
  refLines?: RefLine[];
  /** Plots sharing the Q axis: the cursor is synced and an x zoom is copied. */
  link?: { key: string; group: Set<uPlot>; onScale: (u: uPlot, key: string) => void };
}

function FitPlot({ payload, label, height, yLog = false, refLines, link }: PlotProps) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const width = host.clientWidth || 440;
    const opts = buildOpts(payload, {
      width,
      height,
      yScale: yLog ? "log" : "linear",
      xScale: "linear",
      showGrid: true,
      tool: "zoom",
      onReadout: () => {},
      refLines,
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    // A model line crosses the Q points only another channel has.
    opts.series.forEach((s, i) => {
      if (i > 0 && payload.series[i - 1]?.kind !== "points") s.spanGaps = true;
    });
    if (link) {
      opts.cursor = { ...opts.cursor, sync: { key: link.key } };
      opts.hooks = { ...opts.hooks, setScale: [...(opts.hooks?.setScale ?? []), link.onScale] };
    }
    const plot = new uPlot(opts, payload.data, host);
    link?.group.add(plot);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => plot.setSize({ width: host.clientWidth || width, height }));
    ro?.observe(host);
    return () => {
      ro?.disconnect();
      link?.group.delete(plot);
      plot.destroy();
    };
  }, [payload, label, height, yLog, refLines, link, theme, accent]);

  return <div ref={hostRef} role="img" aria-label={label} style={{ width: "100%", height }} />;
}

export default function ReflFitPlots({ curves, weighting }: { curves: CurvesLike; weighting: Weighting }) {
  const panels = useMemo(() => fitPlotPanels(curves, weighting), [curves, weighting]);
  const key = `refl-fit-${useId()}`;
  const link = useMemo(() => {
    const group = new Set<uPlot>();
    return { key, group, onScale: linkX(group) };
  }, [key]);
  if (!panels.reflectivity && !panels.sld) return null;
  return (
    <div aria-label="fit plots" style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
      {panels.reflectivity && <FitPlot payload={panels.reflectivity} label="data and model" height={170} yLog link={link} />}
      {panels.residual ? (
        <>
          <FitPlot payload={panels.residual} label="residuals" height={100} refLines={ZERO} link={link} />
          <div className="qzk-ds-meta" style={NOTE}>
            Residual = {RESIDUAL_MEANING[weighting]}; zooming Q in either panel zooms both.
          </div>
        </>
      ) : (
        panels.residualNote && (
          <div className="qzk-ds-meta qzk-msg" role="note" style={NOTE}>
            {panels.residualNote}
          </div>
        )
      )}
      {panels.sld && <FitPlot payload={panels.sld} label="SLD profile" height={130} />}
    </div>
  );
}
