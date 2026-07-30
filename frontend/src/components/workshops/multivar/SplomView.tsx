// Multivariate workbench (JMP_GAP J10) — SPLOM canvas host: owns the canvas
// lifecycle + ResizeObserver (StatStageCanvas's exact pattern) over the pure
// `splomRender.draw`. Downsamples to SPLOM_MAX_POINTS per panel HERE (a
// deterministic stride, lib/multivar.downsampleIndices) — never inside the
// renderer, which stays a "draw exactly what I'm given" function — and
// reports the point count / downsample state back up so the panel can show
// the "showing N of M points" note item 3 requires.

import { useEffect, useMemo, useRef } from "react";

import { downsampleIndices, SPLOM_MAX_POINTS } from "../../../lib/multivar";
import type { Accent, Theme } from "../../../store/useApp";
import { draw } from "./splomRender";

export interface SplomViewProps {
  labels: string[];
  rows: number[][];
  theme: Theme;
  accent: Accent;
  /** Called with `[pointsDrawn, pointsTotal]` whenever the sample changes,
   *  so the panel can show a downsample note without duplicating the math. */
  onSampleInfo?: (drawn: number, total: number) => void;
}

export default function SplomView({ labels, rows, theme, accent, onSampleInfo }: SplomViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sampledRows = useMemo(() => {
    const idx = downsampleIndices(rows.length, SPLOM_MAX_POINTS);
    return idx.map((i) => rows[i]);
  }, [rows]);

  useEffect(() => {
    onSampleInfo?.(sampledRows.length, rows.length);
  }, [sampledRows.length, rows.length, onSampleInfo]);

  const data = useMemo(() => (labels.length >= 2 ? { labels, rows: sampledRows } : null), [labels, sampledRows]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => draw(canvas, host, data);
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
    // theme/accent so a re-theme repaints from fresh design tokens (StatStageCanvas's pattern).
  }, [data, theme, accent]);

  return (
    <div ref={hostRef} style={{ position: "relative", width: "100%", height: 320 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
