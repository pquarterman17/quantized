// The Stat Stage's histogram canvas (split out of `statRender.ts`): bars in the
// first series colour with an optional distribution-fit curve, or, for several
// columns (`StatDrawData.series`, shared bin edges), one translucent bar set
// per column in its own series colour with a name legend. The export draws the
// same (`calc/figure_hist_multi.py`).

import { finiteDomain, zeroBasedDomain } from "../../lib/statstage";
import { seriesColor } from "../../lib/uplotOpts";
import { drawNumericXAxis, drawValueAxis, type Rect, type StatDrawData } from "./statRender";


export function drawHistogram(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "histogram" }>,
  ink: string,
  muted: string,
) {
  if (!d.counts.length) return;
  const sets = d.series ?? [{ label: "", counts: d.counts }];
  const xDomain = finiteDomain([d.edges]);
  const yDomain = zeroBasedDomain([...sets.map((s) => s.counts), d.fit?.pdf ?? []]);
  drawNumericXAxis(ctx, rect, xDomain, d.valueLabel, ink, muted);
  drawValueAxis(ctx, rect, yDomain, d.density ? "density" : "count", ink, muted);

  const sx = (v: number) => rect.x + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * rect.w;
  const sy = (v: number) => rect.y + rect.h - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * rect.h;

  sets.forEach((set, k) => {
    const color = seriesColor(k);
    for (let i = 0; i < set.counts.length; i++) {
      const x0 = sx(d.edges[i]);
      const x1 = sx(d.edges[i + 1]);
      const yTop = sy(set.counts[i]);
      const barX = Math.min(x0, x1);
      const barW = Math.abs(x1 - x0);
      const barH = rect.y + rect.h - yTop;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = color;
      ctx.fillRect(barX, yTop, barW, barH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, yTop, barW, barH);
    }
  });

  if (d.series && d.series.length > 1) {
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    d.series.forEach((set, k) => {
      const y = rect.y + 10 + k * 16;
      ctx.fillStyle = seriesColor(k);
      ctx.fillRect(rect.x + rect.w - 120, y - 5, 10, 10);
      ctx.fillStyle = ink;
      ctx.fillText(set.label, rect.x + rect.w - 104, y);
    });
  }

  if (d.fit && d.fit.x.length) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    d.fit.x.forEach((v, i) => {
      const px = sx(v);
      const py = sy(d.fit!.pdf[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
}
