// Magnifier inset: a small uPlot of the same series pinned in the corner,
// seeded to a magnified central x-range and independently box-zoomable (drag to
// focus any feature while the main plot keeps the full scan). One-way — takes
// the active payload as a prop; no cross-plot sync.

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import "uplot/dist/uPlot.min.css";

import { centralRange } from "../../lib/inset";
import type { PlotPayload } from "../../lib/plotdata";
import type { PlotView } from "../../lib/plotview";
import { buildOpts } from "../../lib/uplotOpts";
import type { SeriesCycle } from "../../lib/seriesStyleCycle";
import type { SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";

interface Props {
  payload: PlotPayload;
  styleList?: (SeriesStyle | undefined)[];
  /** P3.3: the SAME cycle positions the stage behind this magnifier was built
   *  with (`lib/seriesStyleCycle.ts`). The inset is a second view of exactly
   *  those series at exactly those display positions, so it must resolve the
   *  same dash/glyph — it has no export of its own to disagree with. */
  seriesCycle?: SeriesCycle;
  /** A background window's own scales; omitted, the focused plot's. The inset
   *  magnifies the plot behind it, so it draws on that plot's scales. */
  view?: Pick<PlotView, "xScale" | "yScale" | "y2Scale" | "xReversed">;
}

export default function InsetPlot({ payload, styleList, seriesCycle, view }: Props) {
  const liveX = useApp((s) => s.xScale);
  const liveY = useApp((s) => s.yScale);
  const liveY2 = useApp((s) => s.y2Scale);
  const liveRev = useApp((s) => s.xReversed);
  const xScale = view ? view.xScale : liveX;
  const yScale = view ? view.yScale : liveY;
  const y2Scale = view ? view.y2Scale : liveY2;
  const xReversed = view ? view.xReversed : liveRev;
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setInsetMode = useApp((s) => s.setInsetMode);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    plotRef.current?.destroy();
    const w = host.clientWidth || 248;
    const h = host.clientHeight || 124;
    const opts = buildOpts(payload, {
      width: w,
      height: h,
      yScale,
      xScale,
      y2Scale: y2Scale ?? undefined,
      xReversed,
      showGrid: true,
      tool: "zoom", // drag to re-zoom the inset
      onReadout: () => {},
      seriesStyles: styleList,
      seriesCycle,
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    // Compact: drop axis titles (the corner box is too small for them).
    opts.axes?.forEach((ax) => {
      ax.label = undefined;
    });
    const u = new uPlot(opts, payload.data, host);
    // Seed a magnified central view *after* creation (a static scale range would
    // pin it and disable box-zoom; setScale leaves it user-zoomable).
    const xs = (payload.data[0] as (number | null)[]).filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    if (xs.length) {
      const [lo, hi] = centralRange(Math.min(...xs), Math.max(...xs), 0.3);
      if (hi > lo) u.setScale("x", { min: lo, max: hi });
    }
    plotRef.current = u;

    const ro = new ResizeObserver(() =>
      plotRef.current?.setSize({ width: host.clientWidth || w, height: host.clientHeight || h }),
    );
    ro.observe(host);
    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [payload, styleList, seriesCycle, theme, accent, xScale, yScale, y2Scale, xReversed]);

  return (
    <div
      className="qzk-glass"
      style={{ position: "absolute", right: 14, bottom: 14, width: 280, height: 168, padding: 6 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 10,
          color: "var(--text-faint)",
          marginBottom: 2,
        }}
      >
        <span>inset · drag to zoom</span>
        <button aria-label="Close inset" className="qzk-tool-btn" title="Close inset" onClick={() => setInsetMode(false)}>
          ×
        </button>
      </div>
      <div ref={hostRef} style={{ position: "absolute", left: 6, right: 6, top: 22, bottom: 6 }} />
    </div>
  );
}
