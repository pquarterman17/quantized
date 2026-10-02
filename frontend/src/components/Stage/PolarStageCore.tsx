// The polar render core (MULTI_PLOT_PLAN item 15): the Canvas2D host + paint
// effect + the pure draw routine, driven entirely by props — ZERO store
// reads — so the same renderer serves both the focused `PolarStage` (fed
// from the live singleton fields by its thin store wrapper) and a background
// window (fed from the window's OWN `PlotView` snapshot — see
// `windows/BackgroundAltModes.tsx`). The item-1 usePlotPayload/PlotViewport
// decomposition precedent, applied to the polar mode.
//
// Row state follows the same analysisData contract as fits/statistics: manual
// exclusions and Data Filter failures are omitted. The publication path uses
// the same helper (`lib/polarFigureSpec.ts`) so screen and export cannot drift.

import { useEffect, useMemo, useRef } from "react";

import { observeResizePaint } from "../../lib/frameCoalesce";
import { POLAR_LINE_PX, polarChannels, polarRadialRange, polarToXY, radiusNorm } from "../../lib/polar";
import { analysisData } from "../../lib/rowstate";
import { niceTicks } from "../../lib/ticks";
import type { Dataset, DataStruct } from "../../lib/types";
import { seriesColor } from "../../lib/uplotOpts";
import type { Accent, Theme } from "../../store/useApp";

export interface PolarStageCoreProps {
  dataset: Dataset | null;
  yKeys: number[] | null;
  seriesStyles: Record<number, { color?: string }>;
  showGrid: boolean;
  /** Rebuild triggers only: `draw` reads design tokens (`--text`,
   *  `--series-*`) at paint time, so a theme/accent switch needs a repaint
   *  even though neither value is a literal draw argument (the PlotViewport
   *  theme/accent prop doc's exact reasoning). */
  theme: Theme;
  accent: Accent;
}

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}

export default function PolarStageCore({
  dataset,
  yKeys,
  seriesStyles,
  showGrid,
  theme,
  accent,
}: PolarStageCoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const data = useMemo(() => analysisData(dataset), [dataset]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => draw(canvas, host, data, yKeys, seriesStyles, showGrid);
    paint();
    return observeResizePaint(host, paint);
  }, [data, yKeys, seriesStyles, showGrid, theme, accent]);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 8 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

function draw(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  data: DataStruct | null,
  yKeys: number[] | null,
  seriesStyles: Record<number, { color?: string }>,
  showGrid: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom / headless
  const W = host.clientWidth || 600;
  const H = host.clientHeight || 400;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!data) return;

  const ink = cssVar("--text", "#e6e6e6");
  const muted = cssVar("--text-dim", "#9aa");
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.max(10, Math.min(W, H) / 2 - 44);
  const angle = data.time;
  const plotted = polarChannels(yKeys, data.labels.length);

  // Shared radial scale across all plotted channels — the export sends this same range.
  const [vmin, vmax] = polarRadialRange(data.values, plotted);

  // Radial grid rings + value labels.
  ctx.strokeStyle = muted;
  ctx.fillStyle = muted;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.lineWidth = 1;
  const ticks = niceTicks(vmin, vmax);
  for (const t of ticks) {
    const rr = radiusNorm(t, vmin, vmax) * radius;
    if (showGrid) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(fmt(t), cx + 4, cy - rr - 1);
  }
  // Outer circle (always).
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.stroke();

  // Angular spokes every 45° with degree labels.
  ctx.fillStyle = muted;
  for (let deg = 0; deg < 360; deg += 45) {
    const [ex, ey] = polarToXY(deg, 1, cx, cy, radius);
    if (showGrid) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    const [lx, ly] = polarToXY(deg, 1.08, cx, cy, radius);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${deg}°`, lx, ly);
  }

  // Series curves.
  plotted.forEach((ch, i) => {
    ctx.strokeStyle = seriesColor(i, seriesStyles[ch]);
    ctx.lineWidth = POLAR_LINE_PX;
    ctx.beginPath();
    let started = false;
    for (let k = 0; k < angle.length; k++) {
      const v = data.values[k]?.[ch];
      if (!Number.isFinite(angle[k]) || !Number.isFinite(v)) {
        started = false;
        continue;
      }
      const [px, py] = polarToXY(angle[k], radiusNorm(v, vmin, vmax), cx, cy, radius);
      if (started) ctx.lineTo(px, py);
      else {
        ctx.moveTo(px, py);
        started = true;
      }
    }
    ctx.stroke();
  });

  // Axis caption (angle = x column, radius = shared value scale).
  ctx.fillStyle = ink;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("angle (°)  ·  radius = value", cx, cy + radius + 24);
}
