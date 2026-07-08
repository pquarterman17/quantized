// Distribution platform (#52) — the histogram itself: DOM bars (height ∝
// count) with an optional SVG fit-curve overlay (item 6b) and bar brushing
// (item 6c). A plain mousedown+mouseup on one bar (no intervening
// mouseenter) brushes that single bin; dragging across bars extends the
// brush to the hovered range on release; shift-click/-drag extends from the
// last anchor. All bin→row math is pure (lib/distribution, lib/distpdf) —
// this component only turns DOM mouse events into (i0, i1, shiftKey) calls.

import { useEffect, useState } from "react";

import { fmtNum } from "../../../lib/format";
import { pdfOverlayPoints } from "../../../lib/distpdf";
import type { HistBins } from "./useDistribution";

export interface HistogramStripProps {
  hist: HistBins;
  fitCurve: { x: number[]; y: number[] } | null;
  brushedBins: [number, number] | null;
  onBrush: (i0: number, i1: number, shiftKey: boolean) => void;
}

export default function HistogramStrip({ hist, fitCurve, brushedBins, onBrush }: HistogramStripProps) {
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  useEffect(() => {
    if (dragAnchor == null) return;
    const finish = (e: MouseEvent) => {
      onBrush(dragAnchor, dragEnd ?? dragAnchor, e.shiftKey);
      setDragAnchor(null);
      setDragEnd(null);
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [dragAnchor, dragEnd, onBrush]);

  const maxCount = Math.max(1, ...hist.counts);
  const domain = { lo: hist.edges[0], hi: hist.edges[hist.edges.length - 1] };
  const n = hist.counts.reduce((s, c) => s + c, 0);
  const binWidth = hist.counts.length > 0 ? (domain.hi - domain.lo) / hist.counts.length : 0;
  const points = fitCurve ? pdfOverlayPoints(fitCurve, domain, binWidth, n, maxCount) : "";

  return (
    <div style={{ position: "relative", marginTop: 12 }}>
      <div
        className="qzk-hist"
        aria-label="histogram"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 1,
          height: 96,
          padding: "0 2px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {hist.counts.map((c, i) => {
          const brushed =
            brushedBins != null && i >= brushedBins[0] && i <= brushedBins[1];
          return (
            <div
              key={i}
              className="qzk-hist-bar"
              title={`[${fmtNum(hist.edges[i])}, ${fmtNum(hist.edges[i + 1])}): ${c}${brushed ? " · selected" : ""}`}
              onMouseDown={() => setDragAnchor(i)}
              onMouseEnter={() => {
                if (dragAnchor != null) setDragEnd(i);
              }}
              style={{
                flex: 1,
                height: `${(c / maxCount) * 100}%`,
                minHeight: c > 0 ? 1 : 0,
                background: brushed ? "var(--accent)" : "var(--series-1, var(--accent))",
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>
      {points && (
        <svg
          aria-label="distribution fit overlay"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, height: 96, width: "100%", pointerEvents: "none" }}
        >
          <polyline
            points={points}
            fill="none"
            stroke="var(--series-2, var(--danger))"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  );
}
