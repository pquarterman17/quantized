// The statistics render core (MULTI_PLOT_PLAN item 15): the Canvas2D host +
// paint effect over an already-computed `StatDrawData`, driven entirely by
// props — ZERO store reads — so the same renderer serves both the focused
// `StatStage` (whose thin store wrapper owns the mode/column toolbar) and a
// background window fed from its own `PlotView` snapshot
// (`windows/BackgroundAltModes.tsx`). All the actual drawing stays in
// `statRender.ts` (pure); this component only owns the canvas lifecycle.

import { useEffect, useRef } from "react";

import type { Accent, Theme } from "../../store/useApp";
import { draw, type StatDrawData } from "./statRender";

export interface StatStageCanvasProps {
  data: StatDrawData | null;
  /** Rebuild triggers only: `statRender.draw` reads design tokens at paint
   *  time, so a theme/accent switch needs a repaint (PolarStageCore's — and
   *  originally StatStage's — exact pattern). */
  theme: Theme;
  accent: Accent;
}

export default function StatStageCanvas({ data, theme, accent }: StatStageCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => draw(canvas, host, data);
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
    // theme/accent so the plot recolors from fresh design tokens (PolarStage's pattern).
  }, [data, theme, accent]);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 8 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
