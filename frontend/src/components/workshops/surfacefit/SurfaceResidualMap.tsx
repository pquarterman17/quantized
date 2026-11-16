// Residual map for the surface fit: every (x, y) point drawn as a square
// coloured by its residual (data - model) on the symmetric diverging ramp, so
// systematic misfit (a tilt, a ring, a missed bump) shows as structure and a
// good fit as noise. A canvas, since a wafer map can carry 10^4+ points; the
// colours come from lib/colormap, the frame from the design tokens.

import { useEffect, useRef } from "react";

import { colormap } from "../../../lib/colormap";
import { useApp } from "../../../store/useApp";

interface Props {
  x: number[];
  y: number[];
  residuals: number[];
  xLabel: string;
  yLabel: string;
  height?: number;
}

const PAD = { l: 12, r: 12, t: 12, b: 12 };

/** Largest absolute residual (>0), the half-range of the colour scale. */
export function residualScale(r: number[]): number {
  let m = 0;
  for (const v of r) if (Number.isFinite(v) && Math.abs(v) > m) m = Math.abs(v);
  return m > 0 ? m : 1;
}

/** Smallest positive step between sorted values, and how many distinct values
 *  there are (gap 0 when fewer than two). */
function minGap(v: number[]): { gap: number; distinct: number } {
  const s = [...v].sort((a, b) => a - b);
  let gap = Infinity;
  let distinct = s.length ? 1 : 0;
  for (let i = 1; i < s.length; i++) {
    const d = s[i] - s[i - 1];
    if (d > 0) {
      distinct++;
      gap = Math.min(gap, d);
    }
  }
  return { gap: Number.isFinite(gap) ? gap : 0, distinct };
}

/** Marker size in pixels. A gridded map (X steps times Y steps about
 *  the point count) tiles: each cell spans one grid step in each direction.
 *  Scattered points get a square from the mean point spacing. */
export function cellSize(x: number[], y: number[], sx: number, sy: number, pw: number, ph: number): { cw: number; ch: number } {
  const gx = minGap(x);
  const gy = minGap(y);
  if (gx.gap > 0 && gy.gap > 0 && gx.distinct * gy.distinct <= 2 * x.length) {
    return { cw: Math.max(2, gx.gap * sx), ch: Math.max(2, gy.gap * sy) };
  }
  const side = Math.max(3, Math.min(14, Math.sqrt((pw * ph) / Math.max(1, x.length)) * 0.95));
  return { cw: side, ch: side };
}

export default function SurfaceResidualMap({ x, y, residuals, xLabel, yLabel, height = 190 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useApp((s) => s.theme);
  const scale = residualScale(residuals);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth || 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < x.length; i++) {
      x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]);
      y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]);
    }
    const pw = w - PAD.l - PAD.r;
    const ph = height - PAD.t - PAD.b;
    const sx = x1 > x0 ? pw / (x1 - x0) : 1;
    const sy = y1 > y0 ? ph / (y1 - y0) : 1;
    const { cw, ch } = cellSize(x, y, sx, sy, pw, ph);
    for (let i = 0; i < x.length; i++) {
      const [r, g, b] = colormap("rdbu", (residuals[i] / scale + 1) / 2);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      const px = PAD.l + (x[i] - x0) * sx;
      const py = PAD.t + ph - (y[i] - y0) * sy;
      ctx.fillRect(px - cw / 2, py - ch / 2, cw, ch);
    }
  }, [x, y, residuals, scale, height, theme]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Residual map of ${yLabel} against ${xLabel}, colour is data minus model, range ±${scale.toPrecision(3)}`}
      style={{ width: "100%", height, border: "1px solid var(--border)", borderRadius: "var(--radius-sm, 4px)" }}
    />
  );
}
