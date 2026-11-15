// The error-bar DRAWING (MAIN_PLAN #36, gap audit 2 #6, gap audit 4 G8), moved
// out of the eager bundle: `uplotOverlays`' errorBarsPlugin / errorSpansPlugin
// keep their options and call these through the startup chunk
// (`lib/regionDecorLoader.ts`, re-exported by `lib/uplotRegionShades.ts`). A
// plot drawn before the chunk lands rebuilds once it settles
// (`Stage/useLazyPlotParts`, which counts error bars as overlays).

import type uPlot from "uplot";

import type { ErrorSpan } from "./errorbars";
import type { ErrorBarPaint } from "./uplotErrorRange";
import { isErrorBand } from "./uplotErrorRange";

export { drawErrorBands } from "./uplotErrorBand";

/** The error-bar plugins' shared draw setup: save, clip to the plot area so
 *  off-range whiskers do not bleed into the axes, 1 px, and a SOLID line --
 *  a dashed series (a fit band) leaves its dash on the shared context, which
 *  drew every error bar dashed (re-audit #6). The caller restores. */
export function beginErrorDraw(ctx: CanvasRenderingContext2D, bbox: { left: number; top: number; width: number; height: number }): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
}

/** Style one column's bars before they are drawn and return the cap half-width
 *  to draw them with. Unstyled bars keep the defaults: the series' own stroke
 *  (else `color`), 1 px, `defaultCap`. A styled cap/width is in POINTS like
 *  the export's `capsize`/`elinewidth`: a cap is drawn 4/3 px per point (the
 *  `ERROR_CAP_HALF_PX` conversion: the default 2 pt is its 3 px), a width as
 *  that many px -- the same canvas pixels the defaults are drawn in, so
 *  restating a default changes nothing. */
export function styleErrorDraw(u: uPlot, col: number, color: string, defaultCap: number): number {
  const s = u.series[col] as uPlot.Series & { qzErr?: ErrorBarPaint };
  const e = s?.qzErr ?? {};
  const ink = typeof s?.stroke === "function" ? (s.stroke as (u: uPlot, i: number) => string | null)(u, col) : null;
  u.ctx.strokeStyle = e.color || ink || color;
  u.ctx.lineWidth = (e.width ?? 0) > 0 ? e.width! : 1; // a bad stored value draws the default
  return (e.cap ?? -1) >= 0 ? (e.cap! * 4) / 3 : defaultCap;
}

/** `errorBarsPlugin`'s draw: symmetric vertical whiskers per column. */
export function drawErrorBars(u: uPlot, errorsByCol: Map<number, (number | null)[]>, color: string, capHalfWidth: number): void {
  const { ctx } = u;
  const xs = u.data[0];
  beginErrorDraw(ctx, u.bbox);
  for (const [col, errs] of errorsByCol) {
    const ys = u.data[col];
    if (!ys || u.series[col]?.show === false || isErrorBand(u, col)) continue;
    const cap = styleErrorDraw(u, col, color, capHalfWidth); // gap audit 2 #6
    const scaleKey = u.series[col]?.scale ?? "y";
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      const y = ys[i];
      const e = errs[i];
      if (x == null || y == null || e == null) continue;
      const px = u.valToPos(x, "x", true);
      const pHi = u.valToPos(y + e, scaleKey, true);
      const pLo = u.valToPos(y - e, scaleKey, true);
      ctx.beginPath();
      ctx.moveTo(px, pLo);
      ctx.lineTo(px, pHi);
      if (cap > 0) {
        ctx.moveTo(px - cap, pHi);
        ctx.lineTo(px + cap, pHi);
        ctx.moveTo(px - cap, pLo);
        ctx.lineTo(px + cap, pLo);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** `errorSpansPlugin`'s draw: asymmetric Y and X whiskers per column. */
export function drawErrorSpans(u: uPlot, spansByCol: Map<number, ErrorSpan[]>, color: string, capHalfWidth: number): void {
  const { ctx } = u;
  const xs = u.data[0];
  beginErrorDraw(ctx, u.bbox);
  for (const [col, spans] of spansByCol) {
    const ys = u.data[col];
    if (!ys || u.series[col]?.show === false) continue;
    const cap = styleErrorDraw(u, col, color, capHalfWidth); // gap audit 2 #6
    const scaleKey = u.series[col]?.scale ?? "y";
    for (const span of spans) {
      if (span.axis === "y" && isErrorBand(u, col)) continue;
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const y = ys[i];
        const up = span.plus[i];
        const dn = span.minus[i];
        if (x == null || y == null || (up == null && dn == null)) continue;
        ctx.beginPath();
        if (span.axis === "y") {
          const py = u.valToPos(y, scaleKey, true);
          const pHi = up == null ? py : u.valToPos(y + up, scaleKey, true);
          const pLo = dn == null ? py : u.valToPos(y - dn, scaleKey, true);
          const px = u.valToPos(x, "x", true);
          ctx.moveTo(px, pLo);
          ctx.lineTo(px, pHi);
          if (cap > 0) {
            ctx.moveTo(px - cap, pHi);
            ctx.lineTo(px + cap, pHi);
            ctx.moveTo(px - cap, pLo);
            ctx.lineTo(px + cap, pLo);
          }
        } else {
          const px = u.valToPos(x, "x", true);
          const pR = up == null ? px : u.valToPos(x + up, "x", true);
          const pL = dn == null ? px : u.valToPos(x - dn, "x", true);
          const py = u.valToPos(y, scaleKey, true);
          ctx.moveTo(pL, py);
          ctx.lineTo(pR, py);
          if (cap > 0) {
            ctx.moveTo(pR, py - cap);
            ctx.lineTo(pR, py + cap);
            ctx.moveTo(pL, py - cap);
            ctx.lineTo(pL, py + cap);
          }
        }
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
