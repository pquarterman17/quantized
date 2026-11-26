// X and Y errors drawn as a RECTANGLE (plan item 24, Origin's "Error Bar" >
// "Box" on an XY plot, `ErrorBarStyle.box`): the canvas half. A series that has
// BOTH an X and a Y error binding draws, for each drawn point (finite x and y),
// the box [x - minusX, x + plusX] x [y - minusY, y + plusY] -- a translucent
// fill and a solid edge in the error colour -- instead of crossbars. A missing
// side is a zero-width side; a point with no error at all draws nothing. A
// series with only one of the two keeps its bars (a rectangle needs both).
// `calc/figure_errorbars.py` draws the export from the same rule. In the
// startup chunk with the bars (`lib/uplotErrorDraw.ts`).

import type uPlot from "uplot";

import type { ErrorSpan } from "./errorbars";
import { offLogScale } from "./uplotErrorDraw";
import type { ErrorBarPaint } from "./uplotErrorRange";
import { FILL_ALPHA_PCT, translucent } from "./uplotFill";

type Col = readonly (number | null | undefined)[];
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const mag = (v: number | null | undefined): number => (fin(v) ? Math.abs(v) : 0);

/** Does this series draw its errors as boxes, given the spans it has? */
export function drawsErrorBox(u: uPlot, col: number, spans: readonly ErrorSpan[]): boolean {
  const e = (u.series[col] as uPlot.Series & { qzErr?: ErrorBarPaint })?.qzErr;
  return !!e?.box && spans.some((s) => s.axis === "x") && spans.some((s) => s.axis === "y");
}

/** The boxes of one series in data units, `[x0, y0, x1, y1]`, in row order. Pure, for the export parity test. */
export function boxRects(xs: Col, ys: Col, xspan: ErrorSpan, yspan: ErrorSpan): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ys.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!fin(x) || !fin(y)) continue;
    const r = [x - mag(xspan.minus[i]), y - mag(yspan.minus[i]), x + mag(xspan.plus[i]), y + mag(yspan.plus[i])];
    if (r[0] !== r[2] || r[1] !== r[3]) out.push(r);
  }
  return out;
}

/** Stroke and fill one series' boxes (the stroke width and colour are `styleErrorDraw`'s, set by the caller). */
export function drawErrorBoxes(u: uPlot, col: number, spans: readonly ErrorSpan[]): void {
  const xspan = spans.find((s) => s.axis === "x")!;
  const yspan = spans.find((s) => s.axis === "y")!;
  const key = u.series[col]?.scale ?? "y";
  const { ctx } = u;
  const edge = ctx.strokeStyle as string;
  ctx.fillStyle = translucent(edge, FILL_ALPHA_PCT);
  for (const [x0, y0, x1, y1] of boxRects(u.data[0] as Col, u.data[col] as Col, xspan, yspan)) {
    if (offLogScale(u, "x", x0) || offLogScale(u, key, y0)) continue;
    const a = u.valToPos(x0, "x", true);
    const b = u.valToPos(x1, "x", true);
    const c = u.valToPos(y1, key, true);
    const d = u.valToPos(y0, key, true);
    ctx.fillRect(Math.min(a, b), Math.min(c, d), Math.abs(b - a), Math.abs(d - c));
    ctx.strokeRect(Math.min(a, b), Math.min(c, d), Math.abs(b - a), Math.abs(d - c));
  }
}
