// Canvas2D rendering for the 2-D map viewer (pure of React). Kept beside
// MapStage so the view component stays a thin shell over this logic. The grid
// is painted to an offscreen nx×ny canvas then blitted scaled — one GPU
// up-scale instead of nx·ny rects. NaN cells (outside the data hull) are
// transparent (gaps), matching uPlot's null = gap for 1-D.

import { COLORMAPS, type ColormapName, colormapCss, normalize, sampleColormap } from "../../lib/colormap";
import type { MapPayload } from "../../lib/mapdata";
import { niceTicks } from "../../lib/ticks";
import type { RsmPeak } from "../../lib/types";

const MARGIN = { left: 58, right: 78, top: 14, bottom: 42 };

export interface Readout {
  x: number;
  y: number;
  z: number | null;
}

/** Compact numeric label: ≤4 sig figs, exponential outside [1e-3, 1e5). */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Plot-area rectangle (inside the axis/colorbar margins), in CSS px. */
function plotRect(w: number, h: number) {
  return {
    x: MARGIN.left,
    y: MARGIN.top,
    w: Math.max(1, w - MARGIN.left - MARGIN.right),
    h: Math.max(1, h - MARGIN.top - MARGIN.bottom),
  };
}

/** Map a pointer position to (x, y, z) at the nearest grid cell, or null if the
 *  pointer is outside the plot area. Pure (no canvas) so it is unit-testable. */
export function hitTest(p: MapPayload, w: number, h: number, px: number, py: number): Readout | null {
  const rect = plotRect(w, h);
  if (px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h) return null;
  const { xAxis, yAxis, zGrid } = p;
  const xmin = xAxis[0];
  const xmax = xAxis[xAxis.length - 1];
  const ymin = yAxis[0];
  const ymax = yAxis[yAxis.length - 1];
  const fx = (px - rect.x) / rect.w;
  const fy = (py - rect.y) / rect.h;
  const x = xmin + fx * (xmax - xmin);
  const y = ymax - fy * (ymax - ymin); // screen y is top-down; data y is bottom-up
  const i = Math.max(0, Math.min(xAxis.length - 1, Math.round(fx * (xAxis.length - 1))));
  const j = Math.max(0, Math.min(yAxis.length - 1, Math.round((1 - fy) * (yAxis.length - 1))));
  return { x, y, z: zGrid[j]?.[i] ?? null };
}

/** Map an RSM peak to (x, y) in the map's *current* space (angular vs Q),
 *  chosen by the displayed axis labels. Returns null when the peak lacks finite
 *  coordinates in that space. centre_angle is `[omega, 2theta]`. */
export function peakMarkerXY(
  peak: RsmPeak,
  xLabel: string,
  yLabel: string,
): [number, number] | null {
  const pick = (label: string): number | null => {
    if (label === "2Theta") return peak.centre_angle[1];
    if (label === "Omega") return peak.centre_angle[0];
    if (label === "Qx") return peak.centre_Q[0];
    if (label === "Qz") return peak.centre_Q[1];
    return null;
  };
  const x = pick(xLabel);
  const y = pick(yLabel);
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

/** Smallest strictly-positive finite cell (the log-scale colour floor). */
export function minPositive(grid: (number | null)[][]): number | null {
  let lo = Infinity;
  for (const row of grid) {
    for (const v of row) {
      if (v != null && Number.isFinite(v) && v > 0 && v < lo) lo = v;
    }
  }
  return Number.isFinite(lo) ? lo : null;
}

export function draw(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  p: MapPayload | null,
  cmap: ColormapName,
  logZ: boolean,
  peaks: RsmPeak[] | null = null,
  smooth = true,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom / headless — nothing to paint
  const W = host.clientWidth || 600;
  const H = host.clientHeight || 400;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!p) return;

  const ink = cssVar("--text", "#e6e6e6");
  const muted = cssVar("--text-dim", "#9aa");
  const rect = plotRect(W, H);
  // Log mode floors at the smallest positive cell (0/negative -> transparent).
  const lo = logZ ? minPositive(p.zGrid) : p.zMin;
  const hi = p.zMax;
  const stops = COLORMAPS[cmap];

  // Offscreen nx×ny image, then one scaled blit (vertically flipped: image row 0
  // is the top = max y).
  if (lo != null && hi != null && hi > lo) {
    const nx = p.xAxis.length;
    const ny = p.yAxis.length;
    const off = document.createElement("canvas");
    off.width = nx;
    off.height = ny;
    const octx = off.getContext("2d");
    if (octx) {
      const img = octx.createImageData(nx, ny);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const v = p.zGrid[j]?.[i];
          const px = ((ny - 1 - j) * nx + i) * 4;
          const t = v == null ? null : normalize(v, lo, hi, logZ);
          if (t == null) {
            img.data[px + 3] = 0;
            continue;
          }
          const [r, g, b] = sampleColormap(stops, t);
          img.data[px] = r;
          img.data[px + 1] = g;
          img.data[px + 2] = b;
          img.data[px + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      // smooth = bilinear-interpolated heatmap; off = crisp pixel cells
      // (Preferences ▸ Plot ▸ Antialias). Crisp suits sparse RSM grids.
      ctx.imageSmoothingEnabled = smooth;
      ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);
    }
  }

  // Plot border.
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);

  drawAxes(ctx, p, rect, ink, muted);
  drawColorbar(ctx, p, rect, W, cmap, lo, hi, logZ, ink, muted);
  if (peaks && peaks.length) drawPeaks(ctx, p, rect, peaks, ink);
}

function drawPeaks(
  ctx: CanvasRenderingContext2D,
  p: MapPayload,
  rect: { x: number; y: number; w: number; h: number },
  peaks: RsmPeak[],
  ink: string,
) {
  const xmin = p.xAxis[0];
  const xmax = p.xAxis[p.xAxis.length - 1];
  const ymin = p.yAxis[0];
  const ymax = p.yAxis[p.yAxis.length - 1];
  ctx.font = "10px 'JetBrains Mono', monospace";
  for (const peak of peaks) {
    const xy = peakMarkerXY(peak, p.xLabel, p.yLabel);
    if (!xy) continue;
    const [vx, vy] = xy;
    if (vx < xmin || vx > xmax || vy < ymin || vy > ymax) continue; // off-map
    const sx = rect.x + ((vx - xmin) / (xmax - xmin)) * rect.w;
    const sy = rect.y + rect.h - ((vy - ymin) / (ymax - ymin)) * rect.h;
    // White cross with a dark halo so it reads on any colormap value.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    _cross(ctx, sx, sy, 6);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#fff";
    _cross(ctx, sx, sy, 6);
    ctx.fillStyle = ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(peak.classification, sx + 8, sy - 2);
  }
}

function _cross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  p: MapPayload,
  rect: { x: number; y: number; w: number; h: number },
  ink: string,
  muted: string,
) {
  const xmin = p.xAxis[0];
  const xmax = p.xAxis[p.xAxis.length - 1];
  const ymin = p.yAxis[0];
  const ymax = p.yAxis[p.yAxis.length - 1];
  ctx.fillStyle = muted;
  ctx.strokeStyle = muted;
  ctx.font = "10px 'JetBrains Mono', monospace";
  // Nice round ticks (60, 60.5, 61 …) positioned at their value's fraction.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const v of niceTicks(xmin, xmax)) {
    const sx = rect.x + ((v - xmin) / (xmax - xmin)) * rect.w;
    ctx.beginPath();
    ctx.moveTo(sx, rect.y + rect.h);
    ctx.lineTo(sx, rect.y + rect.h + 4);
    ctx.stroke();
    ctx.fillText(fmt(v), sx, rect.y + rect.h + 6);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of niceTicks(ymin, ymax)) {
    const sy = rect.y + rect.h - ((v - ymin) / (ymax - ymin)) * rect.h;
    ctx.beginPath();
    ctx.moveTo(rect.x - 4, sy);
    ctx.lineTo(rect.x, sy);
    ctx.stroke();
    ctx.fillText(fmt(v), rect.x - 7, sy);
  }
  // Axis titles.
  ctx.fillStyle = ink;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const xt = p.xUnit ? `${p.xLabel} (${p.xUnit})` : p.xLabel;
  ctx.fillText(xt, rect.x + rect.w / 2, rect.y + rect.h + 38);
  ctx.save();
  ctx.translate(12, rect.y + rect.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  const yt = p.yUnit ? `${p.yLabel} (${p.yUnit})` : p.yLabel;
  ctx.fillText(yt, 0, 0);
  ctx.restore();
}

function drawColorbar(
  ctx: CanvasRenderingContext2D,
  p: MapPayload,
  rect: { x: number; y: number; w: number; h: number },
  W: number,
  cmap: ColormapName,
  lo: number | null,
  hi: number | null,
  logZ: boolean,
  ink: string,
  muted: string,
) {
  const bx = W - MARGIN.right + 16;
  const bw = 14;
  const grad = ctx.createLinearGradient(0, rect.y + rect.h, 0, rect.y);
  for (let s = 0; s <= 8; s++) grad.addColorStop(s / 8, colormapCss(cmap, s / 8));
  ctx.fillStyle = grad;
  ctx.fillRect(bx, rect.y, bw, rect.h);
  ctx.strokeStyle = muted;
  ctx.strokeRect(bx + 0.5, rect.y + 0.5, bw, rect.h);

  // Endpoint labels show the effective colour range (the log floor when on).
  ctx.fillStyle = muted;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (hi != null) ctx.fillText(fmt(hi), bx + bw + 4, rect.y);
  if (lo != null) ctx.fillText(fmt(lo), bx + bw + 4, rect.y + rect.h);
  ctx.fillStyle = ink;
  ctx.save();
  ctx.translate(bx + bw + 30, rect.y + rect.h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const base = p.zUnit ? `${p.zLabel} (${p.zUnit})` : p.zLabel;
  ctx.fillText(logZ ? `${base} — log` : base, 0, 0);
  ctx.restore();
}
