// Y error drawn as a shaded band (origin gap audit 4 G8, `ErrorBarStyle.band`):
// the canvas half. `calc/figure_errorbars.py` draws the export from the same
// rule.
//
// ROW ORDER, NEVER SORTED. The band is one quad per drawn SEGMENT (rows i and
// i+1, both with finite x and y): the error interval at each end, joined. A
// descending X sweep or a hysteresis loop is therefore shaded along the curve
// as acquired, where a "top edge forward, bottom edge back" polygon would
// cross itself on the return branch. Each quad is wound the same way (built
// from its lower-X end), and the quads share one path filled with the nonzero
// rule, so where branches overlap the shade is their union, not a doubled
// alpha. A row with a null breaks the band as it breaks the line; a missing
// magnitude on one side is a zero-height side, as for the bars.

import type uPlot from "uplot";

import type { ErrorSpan } from "./errorbars";
import { beginErrorDraw } from "./uplotErrorDraw";
import { isErrorBand, type ErrorBarPaint } from "./uplotErrorRange";
import { FILL_ALPHA_PCT, translucent } from "./uplotFill";

type Col = readonly (number | null | undefined)[];
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The band quads of one series, in data units: `[xl, hiL, xr, hiR, loR, loL]`
 *  per drawn segment, lower-X end first. Pure, for the export parity test. */
export function bandQuads(xs: Col, ys: Col, plus: Col, minus: Col): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    let a = i;
    let b = i + 1;
    if (!fin(xs[a]) || !fin(ys[a]) || !fin(xs[b]) || !fin(ys[b])) continue;
    if (xs[b]! < xs[a]!) [a, b] = [b, a];
    const hi = (r: number) => ys[r]! + (fin(plus[r]) ? Math.abs(plus[r]!) : 0);
    const lo = (r: number) => ys[r]! - (fin(minus[r]) ? Math.abs(minus[r]!) : 0);
    out.push([xs[a]!, hi(a), xs[b]!, hi(b), lo(b), lo(a)]);
  }
  return out;
}

/** The error plugins' `drawAxes` hook (`uplotOverlays` errorBarsPlugin /
 *  errorSpansPlugin): every band column's Y error, from its spans or its
 *  legacy symmetric magnitudes. Lives in the startup chunk with the bars
 *  (`lib/uplotErrorDraw.ts`). */
export function drawErrorBands(u: uPlot, byCol: Map<number, ErrorSpan[] | (number | null)[]>, color: string): void {
  for (const [col, v] of byCol) {
    if (!isErrorBand(u, col)) continue;
    const spans = v.some((e) => typeof e === "object" && e !== null) ? (v as ErrorSpan[]) : [{ axis: "y", plus: v as Col, minus: v as Col }];
    for (const sp of spans) if (sp.axis === "y") drawErrorBand(u, col, sp.plus, sp.minus, color);
  }
}

/** Fill one series' Y error band, under its line (the plugins call this from
 *  uPlot's `drawAxes` hook, which runs before the series are stroked). */
export function drawErrorBand(u: uPlot, col: number, plus: Col, minus: Col, color: string): void {
  const s = u.series[col] as uPlot.Series & { qzErr?: ErrorBarPaint };
  if (!s || s.show === false) return;
  const key = s.scale ?? "y";
  const ink = typeof s.stroke === "function" ? (s.stroke as (u: uPlot, i: number) => string | null)(u, col) : null;
  const path = new Path2D();
  for (const [xl, hl, xr, hr, lr, ll] of bandQuads(u.data[0] as Col, u.data[col] as Col, plus, minus)) {
    const pl = u.valToPos(xl, "x", true);
    const pr = u.valToPos(xr, "x", true);
    path.moveTo(pl, u.valToPos(hl, key, true));
    path.lineTo(pr, u.valToPos(hr, key, true));
    path.lineTo(pr, u.valToPos(lr, key, true));
    path.lineTo(pl, u.valToPos(ll, key, true));
    path.closePath();
  }
  beginErrorDraw(u.ctx, u.bbox);
  u.ctx.fillStyle = translucent(s.qzErr?.color || ink || color, FILL_ALPHA_PCT);
  u.ctx.fill(path);
  u.ctx.restore();
}
