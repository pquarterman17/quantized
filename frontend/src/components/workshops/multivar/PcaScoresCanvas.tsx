// Multivariate workbench (JMP_GAP J10) — canvas host for the PCA
// scores/loadings/biplot view. StatStageCanvas's exact pattern: owns the
// canvas + ResizeObserver lifecycle over the pure `pcaScoresRender.draw`.

import { useEffect, useRef } from "react";

import type { Accent, Theme } from "../../../store/useApp";
import { draw, type PcaDrawData } from "./pcaScoresRender";

export interface PcaScoresCanvasProps {
  data: PcaDrawData | null;
  theme: Theme;
  accent: Accent;
}

export default function PcaScoresCanvas({ data, theme, accent }: PcaScoresCanvasProps) {
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
  }, [data, theme, accent]);

  return (
    <div ref={hostRef} style={{ position: "relative", width: "100%", height: 260 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
