// The Quick Figure Builder's live preview: the Graph Builder's xy painter
// (`graphbuilder/previewCanvas.drawXY`, the one `GraphPreview` uses) fed the
// setup panel's per-series styles, plus a legend in the chosen corner drawn
// with the Stage's own swatch (`LegendSample`) and corner classes. Line width
// and dash, and the grid, are not drawn by that compact painter; they reach
// the created figure (pinned in store/quickFigureSetup.test.ts).

import { useEffect, useRef } from "react";

import type { SpecRender } from "../../../lib/plotspec";
import type { LegendPos } from "../../../lib/plotview";
import type { SeriesStyle } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import LegendSample from "../../Stage/LegendSample";
import { drawXY } from "../graphbuilder/previewCanvas";

export default function QuickFigurePreviewCanvas({
  render,
  styles,
  legend,
}: {
  render: SpecRender;
  styles?: readonly SeriesStyle[];
  /** The legend corner, or null when the legend is hidden. */
  legend: LegendPos | null;
}) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => {
      if (render.kind === "xy") {
        drawXY(canvas, host, render.payload, render.mark, render.showMarkers ?? false, render.stepMode ?? "post", render.errorSpans, styles);
      } else {
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    paint();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
  }, [render, styles, theme, accent]);

  return (
    <div className="qzk-graph-preview">
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
      {render.kind === "xy" && legend && render.payload.series.length > 0 && (
        <div className={`qzk-glass qzk-legend ${legend}`} aria-label="Preview legend">
          {render.payload.series.map((series, i) => (
            <div className="it" key={`${i}-${series.label}`}>
              <LegendSample
                color={styles?.[i]?.color ?? `var(--series-${(i % 8) + 1})`}
                style={styles?.[i]}
                defaultTrace={render.mark === "scatter" ? "Scatter" : render.showMarkers ? "Line + markers" : "Line"}
              />
              {series.label}
            </div>
          ))}
        </div>
      )}
      {render.kind === "message" && (
        <div className={`qzk-graph-preview-msg${render.tone === "note" ? " note" : ""}`}>{render.message}</div>
      )}
    </div>
  );
}
