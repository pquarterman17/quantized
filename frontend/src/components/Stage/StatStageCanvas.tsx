// The statistics render core (MULTI_PLOT_PLAN item 15): the Canvas2D host +
// paint effect over an already-computed `StatDrawData`, driven entirely by
// props — ZERO store reads — so the same renderer serves both the focused
// `StatStage` (whose thin store wrapper owns the mode/column toolbar) and a
// background window fed from its own `PlotView` snapshot
// (`windows/BackgroundAltModes.tsx`). All the actual drawing stays in
// `statRender.ts` (pure); this component only owns the canvas lifecycle.
//
// `onSlotClick` (P2.6 box 4, focused stage only): a click on the plot is
// mapped to the drawn category slot under it (`statRenderSelection.
// slotIndexAt`, in the same CSS-pixel frame `draw` lays out in).

import { useEffect, useRef, type MouseEvent } from "react";

import { observeResizePaint } from "../../lib/frameCoalesce";
import type { Accent, Theme } from "../../store/useApp";
import { draw, type StatDrawData } from "./statRender";
import { clickedSlotAt } from "./statRenderSelection";

export interface StatStageCanvasProps {
  data: StatDrawData | null;
  /** Rebuild triggers only: `statRender.draw` reads design tokens at paint
   *  time, so a theme/accent switch needs a repaint (PolarStageCore's — and
   *  originally StatStage's — exact pattern). */
  theme: Theme;
  accent: Accent;
  /** How many category slots `data` draws (0 = not clickable). */
  slotCount?: number;
  onSlotClick?: (slot: number, e: MouseEvent) => void;
}

export default function StatStageCanvas({ data, theme, accent, slotCount = 0, onSlotClick }: StatStageCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => draw(canvas, host, data);
    paint();
    return observeResizePaint(host, paint);
    // theme/accent so the plot recolors from fresh design tokens (PolarStage's pattern).
  }, [data, theme, accent]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const host = hostRef.current;
    if (!host || !onSlotClick || slotCount <= 0 || !data) return;
    const box = host.getBoundingClientRect();
    // P2.6 review finding 10: only a click on the slot's own drawn content
    // (its box/violin/bar body, whisker span, or tick label) selects — a
    // click on blank background between/around the glyphs does nothing.
    const i = clickedSlotAt(
      data,
      host.clientWidth || 600,
      host.clientHeight || 400,
      e.clientX - box.left,
      e.clientY - box.top,
      slotCount,
    );
    if (i !== null) onSlotClick(i, e);
  }

  return (
    <div
      ref={hostRef}
      style={{ position: "absolute", inset: 8 }}
      data-testid={onSlotClick ? "stat-canvas-host" : undefined}
      onClick={onSlotClick ? onClick : undefined}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
