import { useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { frameAnchorStyle } from "../../lib/uplotFrameVars";
import { openFigureDialog } from "../../store/figureDialogs";
import { useApp, type PlotTool } from "../../store/useApp";

/** Pointer travel (px) before a press on the legend box becomes a drag. */
const DRAG_THRESHOLD_PX = 3;
const clamp =(value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Position and move behavior for the DOM legend box. */
export function useLegendBox(tool: PlotTool) {
  const legendPos = useApp((s) => s.legendPos);
  const legendXY = useApp((s) => s.legendXY);
  const legendFrameXY = useApp((s) => s.legendFrameXY);
  const legendSize = useApp((s) => s.legendSize);
  const setLegendXY = useApp((s) => s.setLegendXY);
  const boxRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const fractionAt = (clientX: number, clientY: number): [number, number] | null => {
    const rect = boxRef.current?.parentElement?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [clamp((clientX - rect.left) / rect.width, 0, 1), clamp((clientY - rect.top) / rect.height, 0, 1)];
  };

  // The box background: the box itself or the content wrapper's empty space
  // (row gaps, and whatever an enlarged box adds), never a row.
  const isBoxSurface = (e: ReactMouseEvent) =>
    e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("qzk-legend-content");

  const onBoxMouseDown = (e: ReactMouseEvent) => {
    if (tool !== "pointer" || e.button !== 0 || !isBoxSurface(e)) return;
    e.preventDefault();
    let recorded = false;
    const [sx, sy] = [e.clientX, e.clientY];
    const onMove = (ev: MouseEvent) => {
      // A click with a little hand jitter is not a drag: it must neither move
      // the box nor spoil the double-click that opens legend formatting.
      if (!recorded && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD_PX) return;
      const xy = fractionAt(ev.clientX, ev.clientY);
      if (!xy) return;
      if (!recorded) {
        useApp.getState().recordHistory("move legend");
        recorded = true;
      }
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setLegendXY(xy));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const onBoxDoubleClick = (e: ReactMouseEvent) => {
    if (tool !== "pointer" || !isBoxSurface(e)) return;
    // Legend formatting (entries, corner, visibility); "Reset position" (the
    // old double-click action) lives in that dialog.
    openFigureDialog({ kind: "legend" });
  };

  return {
    boxRef, legendPos, isFree: !!legendFrameXY || !!legendXY,
    style: legendBoxStyle(legendFrameXY, legendXY, legendSize), onBoxMouseDown, onBoxDoubleClick,
  };
}

/** The legend box's inline placement — frame anchor > free fraction > (none:
 *  the corner class places it) — plus a saved size. Shared with the
 *  unfocused window's read-only legend (gap audit 2 #3). */
export function legendBoxStyle(
  frameXY: [number, number] | null,
  xy: [number, number] | null,
  size: [number, number] | null,
): CSSProperties | undefined {
  const base: CSSProperties | undefined = frameXY
    ? frameAnchorStyle(frameXY)
    : xy
      ? { left: `${xy[0] * 100}%`, top: `${xy[1] * 100}%`, right: "auto", bottom: "auto" }
      : undefined;
  return size ? { ...base, width: size[0], height: size[1] } : base;
}
