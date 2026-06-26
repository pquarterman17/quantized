// Polar plot mode: render the active series with x interpreted as an angle (deg)
// and y as the radius. For angular-dependence data (signal vs sample rotation).
// Canvas2D, self-contained (mirrors MapStage's render approach); a "✺" toggle in
// the plot toolbar enters/leaves it. All plotted channels share one radial scale.

import { useEffect, useRef } from "react";

import { polarToXY, radiusNorm } from "../../lib/polar";
import { niceTicks } from "../../lib/ticks";
import { seriesColor } from "../../lib/uplotOpts";
import { useActiveDataset, useApp } from "../../store/useApp";

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

export default function PolarStage() {
  const active = useActiveDataset();
  const yKeys = useApp((s) => s.yKeys);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const showGrid = useApp((s) => s.showGrid);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setPolarMode = useApp((s) => s.setPolarMode);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => draw(canvas, host, active, yKeys, seriesStyles, showGrid);
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
  }, [active, yKeys, seriesStyles, showGrid, theme, accent]);

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
      <div className="qzk-glass qzk-float-tools">
        <button className="qzk-tool-btn active" title="Back to a cartesian plot" onClick={() => setPolarMode(false)}>
          ✺
        </button>
      </div>
      {!active && (
        <div className="qzk-ds-meta" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          Select a dataset to plot
        </div>
      )}
    </div>
  );
}

interface DS {
  data: { time: number[]; values: number[][]; labels: string[]; units: string[] };
}

function draw(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  active: DS | null,
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
  if (!active) return;

  const ink = cssVar("--text", "#e6e6e6");
  const muted = cssVar("--text-dim", "#9aa");
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.max(10, Math.min(W, H) / 2 - 44);
  const angle = active.data.time;
  const plotted = yKeys ?? active.data.labels.map((_, i) => i);

  // Shared radial scale across all plotted channels.
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const ch of plotted) {
    for (const row of active.data.values) {
      const v = row[ch];
      if (Number.isFinite(v)) {
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    }
  }
  if (!Number.isFinite(vmin) || vmax <= vmin) {
    vmin = 0;
    vmax = 1;
  }

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
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let k = 0; k < angle.length; k++) {
      const v = active.data.values[k]?.[ch];
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
