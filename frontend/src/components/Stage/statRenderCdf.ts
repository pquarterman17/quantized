// The Stat Stage's CDF / ECDF canvas and the rug ticks it shares with the
// histogram (plan item 20). Every vertex comes from `lib/statCdf` (`cdfGeometry`,
// `rugTicks`), which the export's `calc/statplots_cdf.py` mirrors and the wire
// fixture `tests/fixtures/wire/stat_cdf_rug.json` pins, so this file only maps
// data coordinates to pixels. The export is `calc/figure_cdf.py` + `figure_rug.py`.

import { cdfGeometry, rugTicks, type CdfWire, type Pt, type ResolvedRug } from "../../lib/statCdf";
import { seriesColor } from "../../lib/uplotOpts";
import { drawNumericXAxis, drawValueAxis, type Rect } from "./statRender";

/** A rug to paint: its resolved look and one finite-value list per column. */
export interface RugDraw {
  opts: ResolvedRug;
  columns: number[][];
}

export interface CdfDraw {
  mode: "cdf";
  wire: CdfWire;
  labels: string[];
  /** The finite values behind each series (the rug's ticks). */
  columns: number[][];
  valueLabel: string;
  rug?: RugDraw | null;
}

/** Axes-fraction height `y` -> canvas y (0 = the bottom edge of the plot). */
const fromBottom = (rect: Rect, y: number) => rect.y + rect.h - y * rect.h;

/** One short tick per finite value along the X axis, a row per column. */
export function drawRug(ctx: CanvasRenderingContext2D, rect: Rect, rug: RugDraw, domain: [number, number]) {
  const sx = (v: number) => rect.x + ((v - domain[0]) / (domain[1] - domain[0])) * rect.w;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.globalAlpha = rug.opts.opacity;
  ctx.lineWidth = 1;
  rug.columns.forEach((col, k) => {
    ctx.strokeStyle = seriesColor(k);
    ctx.beginPath();
    for (const [x, y0, y1] of rugTicks(col, k, rug.opts.length)) {
      ctx.moveTo(sx(x), fromBottom(rect, y0));
      ctx.lineTo(sx(x), fromBottom(rect, y1));
    }
    ctx.stroke();
  });
  ctx.restore();
}

function path(ctx: CanvasRenderingContext2D, pts: readonly Pt[], sx: (v: number) => number, sy: (v: number) => number) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y))));
}

export function drawCdf(ctx: CanvasRenderingContext2D, rect: Rect, d: CdfDraw, ink: string, muted: string) {
  const geo = cdfGeometry(d.wire);
  const [xLo, xHi] = geo.domain;
  drawNumericXAxis(ctx, rect, geo.domain, d.valueLabel, ink, muted);
  drawValueAxis(ctx, rect, [0, geo.y_max], d.wire.y === "count" ? "cumulative count" : "cumulative proportion", ink, muted);
  const sx = (v: number) => rect.x + ((v - xLo) / (xHi - xLo)) * rect.w;
  const sy = (v: number) => fromBottom(rect, v / geo.y_max);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  geo.series.forEach((g, k) => {
    const color = seriesColor(k);
    if (g.band) {
      path(ctx, g.band, sx, sy);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    path(ctx, g.step, sx, sy);
    ctx.stroke();
    if (g.fit) {
      ctx.setLineDash([5, 4]);
      path(ctx, g.fit, sx, sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  ctx.restore();

  if (geo.series.length > 1) {
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    d.labels.forEach((label, k) => {
      const y = rect.y + 10 + k * 16;
      ctx.fillStyle = seriesColor(k);
      ctx.fillRect(rect.x + rect.w - 120, y - 5, 10, 10);
      ctx.fillStyle = ink;
      ctx.fillText(label, rect.x + rect.w - 104, y);
    });
  }
  if (d.rug) drawRug(ctx, rect, d.rug, geo.domain);
}
