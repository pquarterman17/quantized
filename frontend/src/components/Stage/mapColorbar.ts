// The 2-D map's colour bar (split out of `mapRender.ts`, which is at its
// module ceiling). Painted by `mapRender.draw` over the SAME [lo, hi] pair the
// heatmap uses, so the bar cannot disagree with the pixels it labels.

import { type ColormapName, colormapCss } from "../../lib/colormap";
import type { MapPayload } from "../../lib/mapdataFetch";

/** Compact numeric label: ≤4 sig figs, exponential outside [1e-3, 1e5). */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
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
