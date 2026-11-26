// The Stat Stage's marginal plot canvas (plan item 20): a scatter with the
// distribution of each axis along its top and right. Every vertex comes from
// `lib/statMarginal.marginalGeometry`, which `calc/statplots_marginal.py`
// mirrors for the matplotlib export (`calc/figure_dist2.py`) and the wire
// fixture `tests/fixtures/wire/stat_marginal.json` pins; this file only maps
// data coordinates to pixels. The strips take the same fractions of the plot
// area as the export's grid (`MARGINAL_RATIO`, `MARGINAL_GAP`).

import {
  MARGINAL_BOX_BAND,
  MARGINAL_GAP,
  MARGINAL_RATIO,
  marginalGeometry,
  type MarginalStrip,
  type MarginalWire,
} from "../../lib/statMarginal";
import { seriesColor } from "../../lib/uplotOpts";
import { drawNumericXAxis, drawValueAxis, type Rect } from "./statRender";

export interface MarginalDraw {
  mode: "marginal";
  wire: MarginalWire;
  xLabel: string;
  yLabel: string;
}

/** Marker radius (px), the points' alpha and the strips' alpha (the export's
 *  `POINT_ALPHA` / `STRIP_ALPHA`). */
export const POINT_RADIUS = 2;
export const POINT_ALPHA = 0.6;
export const STRIP_ALPHA = 0.55;

/** The scatter and the two strips inside the plot area `rect`. */
export function marginalRects(rect: Rect): { main: Rect; top: Rect; right: Rect } {
  const r = MARGINAL_RATIO;
  const g = MARGINAL_GAP;
  const mw = rect.w * (1 - r - g);
  const mh = rect.h * (1 - r - g);
  const main = { x: rect.x, y: rect.y + rect.h * (r + g), w: mw, h: mh };
  return {
    main,
    top: { x: rect.x, y: rect.y, w: mw, h: rect.h * r },
    right: { x: rect.x + rect.w * (1 - r), y: main.y, w: rect.w * r, h: mh },
  };
}

function drawStrip(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  axis: "x" | "y",
  strip: MarginalStrip,
  domain: [number, number],
  color: string,
  muted: string,
) {
  const span = domain[1] - domain[0];
  // `a` along the strip in data units, `c` across it from the scatter's edge.
  const at = (a: number, c: number): [number, number] =>
    axis === "x"
      ? [r.x + ((a - domain[0]) / span) * r.w, r.y + r.h - c * r.h]
      : [r.x + c * r.w, r.y + r.h - ((a - domain[0]) / span) * r.h];
  const poly = (a0: number, a1: number, c0: number, c1: number) => {
    ctx.beginPath();
    [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  const seg = (a0: number, c0: number, a1: number, c1: number) => {
    ctx.moveTo(...at(a0, c0));
    ctx.lineTo(...at(a1, c1));
  };
  ctx.strokeStyle = muted;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (strip.kind === "histogram") {
    ctx.globalAlpha = STRIP_ALPHA;
    for (const [a0, a1, h] of strip.bars) {
      poly(a0, a1, 0, h);
      ctx.fill();
    }
  } else if (strip.kind === "box") {
    const [lo, hi] = MARGINAL_BOX_BAND;
    const mid = (lo + hi) / 2;
    ctx.globalAlpha = STRIP_ALPHA;
    poly(strip.box[0], strip.box[1], lo, hi);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.beginPath();
    seg(strip.median, lo, strip.median, hi);
    seg(strip.whiskers[0], mid, strip.box[0], mid);
    seg(strip.box[1], mid, strip.whiskers[1], mid);
    ctx.stroke();
    ctx.beginPath();
    for (const v of strip.fliers) {
      const [x, y] = at(v, mid);
      ctx.moveTo(x + 2, y);
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
    }
    ctx.stroke();
  } else {
    ctx.globalAlpha = STRIP_ALPHA;
    ctx.beginPath();
    for (const [a, c0, c1] of strip.ticks) seg(a, c0, a, c1);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawMarginal(ctx: CanvasRenderingContext2D, rect: Rect, d: MarginalDraw, ink: string, muted: string) {
  const geo = marginalGeometry(d.wire);
  const { x: xd, y: yd } = geo.domain;
  const { main, top, right } = marginalRects(rect);
  const color = seriesColor(0);
  drawNumericXAxis(ctx, main, xd, d.xLabel, ink, muted);
  drawValueAxis(ctx, { ...main }, yd, d.yLabel, ink, muted);
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(main.x + 0.5, main.y + 0.5, main.w, main.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(main.x, main.y, main.w, main.h);
  ctx.clip();
  ctx.globalAlpha = POINT_ALPHA;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const [x, y] of geo.points) {
    const px = main.x + ((x - xd[0]) / (xd[1] - xd[0])) * main.w;
    const py = main.y + main.h - ((y - yd[0]) / (yd[1] - yd[0])) * main.h;
    ctx.moveTo(px + POINT_RADIUS, py);
    ctx.arc(px, py, POINT_RADIUS, 0, 2 * Math.PI);
  }
  ctx.fill();
  ctx.restore();

  drawStrip(ctx, top, "x", geo.strips.x, xd, color, muted);
  drawStrip(ctx, right, "y", geo.strips.y, yd, color, muted);
}
