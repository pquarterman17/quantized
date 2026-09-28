import { useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { nearestLegendCorner } from "../../lib/plotview";
import { frameAnchorStyle } from "../../lib/uplotFrameVars";
import { useApp, type PlotTool } from "../../store/useApp";

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Position and move behavior for the DOM legend box. */
export function useLegendBox(tool: PlotTool) {
  const legendPos = useApp((s) => s.legendPos);
  const legendXY = useApp((s) => s.legendXY);
  const legendFrameXY = useApp((s) => s.legendFrameXY);
  const legendSize = useApp((s) => s.legendSize);
  const setLegendXY = useApp((s) => s.setLegendXY);
  const setLegendPos = useApp((s) => s.setLegendPos);
  const boxRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const fractionAt = (clientX: number, clientY: number): [number, number] | null => {
    const rect = boxRef.current?.parentElement?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [clamp((clientX - rect.left) / rect.width, 0, 1), clamp((clientY - rect.top) / rect.height, 0, 1)];
  };

  const onBoxMouseDown = (e: ReactMouseEvent) => {
    if (tool !== "pointer" || e.button !== 0 || e.target !== e.currentTarget) return;
    e.preventDefault();
    let recorded = false;
    const onMove = (ev: MouseEvent) => {
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
    if (tool !== "pointer" || e.target !== e.currentTarget || (!legendXY && !legendFrameXY)) return;
    if (legendXY) setLegendPos(nearestLegendCorner(legendXY[0], legendXY[1]));
    else useApp.getState().recordHistory("reset legend position");
    setLegendXY(null);
  };

  const baseStyle: CSSProperties | undefined = legendFrameXY
    ? frameAnchorStyle(legendFrameXY)
    : legendXY
      ? { left: `${legendXY[0] * 100}%`, top: `${legendXY[1] * 100}%`, right: "auto", bottom: "auto" }
      : undefined;
  const style: CSSProperties | undefined = legendSize
    ? { ...baseStyle, width: legendSize[0], height: legendSize[1] }
    : baseStyle;

  return {
    boxRef, legendPos, isFree: !!legendFrameXY || !!legendXY,
    isSized: !!legendSize, style, onBoxMouseDown, onBoxDoubleClick,
  };
}
