// A small, self-contained uPlot for workshop panels (data + model, residual
// and diagnostic plots), built from a PlotPayload by lib/uplotOpts' buildOpts
// with the zoom tool, a grid and theme-reactive colours. Extracted from the
// reflectivity fit view (ReflFitPlots, P2.2) so the Curve Fit residual plots
// draw through the SAME component instead of a second copy. Optional `link`
// syncs the cursor and copies an x zoom across a group (reflFitResiduals'
// linkX).

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { PlotPayload } from "../../lib/plotdata";
import type { RefLine } from "../../lib/types";
import { buildOpts } from "../../lib/uplotOpts";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import { useApp } from "../../store/useApp";

interface PlotProps {
  payload: PlotPayload;
  label: string;
  height: number;
  yLog?: boolean;
  refLines?: RefLine[];
  /** Plots sharing the Q axis: the cursor is synced and an x zoom is copied. */
  link?: { key: string; group: Set<uPlot>; onScale: (u: uPlot, key: string) => void };
  /** A diagnostic plot in a narrow panel: smaller text, thin axis bands and
   *  small markers, so the data area keeps most of a ~160 px height. */
  compact?: boolean;
}

/** Compact axis bands (px): the x tick row and an axis title. `buildOpts`
 *  reserves at least 50 + 30 px below the plot for the main graph's fonts,
 *  which left a 110 px residual plot under 20 px of data area — a flat line of
 *  markers with one tick. */
const COMPACT = { fontSize: 10, xTicks: 28, title: 18, marker: 4 } as const;

export default function SmallUPlot({ payload, label, height, yLog = false, refLines, link, compact = false }: PlotProps) {
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
      ...(compact ? { fontSize: COMPACT.fontSize } : {}),
    });
    if (compact) {
      opts.axes?.forEach((a, i) => {
        a.labelSize = COMPACT.title;
        if (i === 0) a.size = COMPACT.xTicks;
      });
      opts.series.forEach((sr, i) => {
        if (i > 0 && payload.series[i - 1]?.kind === "points" && sr.points) sr.points = { ...sr.points, size: COMPACT.marker };
      });
    }
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
  }, [payload, label, height, yLog, refLines, link, compact, theme, accent]);

  return <div ref={hostRef} role="img" aria-label={label} style={{ width: "100%", height }} />;
}
