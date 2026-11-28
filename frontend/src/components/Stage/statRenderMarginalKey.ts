// The marginal plot's corner key (plan item 20): the cell above the right strip, which the
// 3 x 3 grid leaves empty, says what the opt-in encodings mean — the group names (a coloured
// dot each), the colour column's range as a gradient bar and the size column's marks. What it
// says is `marginalGeometry(wire).key` (pinned by `wire/stat_dist2_options.json`); the export's
// twin is `calc/figure_dist2_key.py`. Lazy only (the Stat Stage).

import { colormap } from "../../lib/colormap";
import type { MarginalKey } from "../../lib/statMarginal";
import type { Rect } from "./statRender";

const ROW = 11;
const num = (v: number) => String(Number(v.toPrecision(3)));

export function drawMarginalKey(
  ctx: CanvasRenderingContext2D,
  cell: Rect,
  key: MarginalKey,
  groupColor: (id: number) => string,
  ink: string,
  muted: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cell.x, cell.y, cell.w, cell.h);
  ctx.clip();
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const pad = 4;
  if (key.groups) {
    const g = key.groups;
    g.ids.forEach((id, i) => {
      const y = cell.y + ROW * (i + 0.5);
      ctx.fillStyle = groupColor(id);
      ctx.beginPath();
      ctx.arc(cell.x + pad + 3, y, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.fillText(g.labels[i], cell.x + pad + 10, y);
    });
    if (g.more) {
      ctx.fillStyle = muted;
      ctx.fillText(`+ ${g.more} more`, cell.x + pad + 10, cell.y + ROW * (g.ids.length + 0.5));
    }
  }
  if (key.color) {
    const c = key.color;
    const x0 = cell.x + pad;
    const w = cell.w - 2 * pad;
    const y0 = cell.y + cell.h * 0.3;
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const [r, g, b] = colormap("viridis", i / (steps - 1));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x0 + (w * i) / steps, y0, w / steps + 0.5, 7);
    }
    ctx.fillStyle = muted;
    ctx.textAlign = "left";
    ctx.fillText(num(c.lo), x0, y0 + 13);
    ctx.textAlign = "right";
    ctx.fillText(num(c.hi), x0 + w, y0 + 13);
    ctx.textAlign = "center";
    if (c.label) {
      ctx.fillStyle = ink;
      ctx.fillText(c.label, x0 + w / 2, y0 - 5);
    }
  }
  if (key.size) {
    const s = key.size;
    ctx.textAlign = "left";
    let x = cell.x + pad;
    const y = cell.y + cell.h - 9;
    if (s.label) {
      ctx.fillStyle = ink;
      ctx.fillText(s.label, x, y - 14);
    }
    for (const [v, d] of s.marks) {
      ctx.fillStyle = muted;
      ctx.beginPath();
      ctx.arc(x + d / 2, y, d / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.fillText(num(v), x + d + 2, y);
      x += d + 4 + ctx.measureText(num(v)).width + 4;
    }
  }
  ctx.restore();
}
