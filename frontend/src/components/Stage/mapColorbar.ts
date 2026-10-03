// The 2-D map's colour bar (split out of `mapRender.ts`, which is at its
// module ceiling). Painted by `mapRender.draw` over the SAME [lo, hi] pair the
// heatmap uses, so the bar cannot disagree with the pixels it labels.

import { type ColormapName, colormapCss, normalize } from "../../lib/colormap";
import type { MapPayload } from "../../lib/mapdataFetch";
import { niceTicks } from "../../lib/ticks";
import { withUnit } from "../../lib/unitDisplay";

/** Compact numeric label: ≤4 sig figs, exponential outside [1e-3, 1e5). */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}

/** Interior colour-bar ticks for `[lo, hi]` on a bar `h` px tall: decades on a
 *  log scale (at most six, thinned evenly), round values on a linear one —
 *  never within 12 px of an end, where the range's own labels sit. `y` is px
 *  up from the bar's bottom. */
export function colorbarTicks(lo: number, hi: number, logZ: boolean, h: number): { y: number; label: string }[] {
  let ticks: { v: number; label: string }[];
  if (logZ) {
    if (!(lo > 0 && hi > lo)) return [];
    const k0 = Math.ceil(Math.log10(lo));
    const n = Math.floor(Math.log10(hi)) - k0 + 1;
    const step = Math.max(1, Math.ceil(n / 6));
    ticks = Array.from({ length: Math.ceil(Math.max(0, n) / step) }, (_, i) => {
      const k = k0 + i * step;
      return { v: 10 ** k, label: Math.abs(k) >= 3 ? `1e${k}` : fmt(10 ** k) };
    });
  } else {
    ticks = niceTicks(lo, hi).map((v) => ({ v, label: fmt(v) }));
  }
  return ticks
    .map(({ v, label }) => ({ y: (normalize(v, lo, hi, logZ) ?? -1) * h, label }))
    .filter(({ y }) => y >= 12 && y <= h - 12);
}

export function drawColorbar(
  ctx: CanvasRenderingContext2D,
  p: MapPayload,
  rect: { x: number; y: number; w: number; h: number },
  bx: number, // the bar's left edge (CSS px)
  cmap: ColormapName,
  lo: number | null,
  hi: number | null,
  logZ: boolean,
  ink: string,
  muted: string,
) {
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
  const base = withUnit(p.zLabel, p.zUnit);
  const title = logZ ? `${base} — log` : base;
  // A long tick label beside the bar's middle would run into the rotated title.
  const half = (title.length * 11 * 0.6) / 2 + 4;
  if (lo != null && hi != null) {
    for (const { y, label } of colorbarTicks(lo, hi, logZ, rect.h)) {
      const sy = rect.y + rect.h - y;
      ctx.beginPath();
      ctx.moveTo(bx + bw - 3, sy);
      ctx.lineTo(bx + bw, sy);
      ctx.stroke();
      if (label.length <= 4 || Math.abs(sy - (rect.y + rect.h / 2)) > half) ctx.fillText(label, bx + bw + 4, sy);
    }
  }
  ctx.fillStyle = ink;
  ctx.save();
  ctx.translate(bx + bw + 30, rect.y + rect.h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(title, 0, 0);
  ctx.restore();
}
