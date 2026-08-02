// Graph Builder mini-preview error whiskers (ORIGIN_GAP_PLAN #51 phase 3) — a
// small, honest sibling of the Stage's real uplotOverlays.errorBarsPlugin:
// same data shape (lib/errorbars.ErrorSpan), same pairing, drawn as plain
// canvas line segments instead of a uPlot draw hook (this preview never
// mounts a real uPlot instance — see GraphPreview's module doc). Kept in its
// own module so GraphPreview.tsx (already near the 400-line component
// ceiling) only pays for the call site, not the drawing logic.

import type { ErrorSpan } from "../../../lib/errorbars";

/** Whisker end-cap half-width, CSS px. */
const CAP = 3;

/** Draw ± whiskers for one series' finite points. `spans` may carry a y-axis
 *  entry, an x-axis entry, or both (a Y-error well AND an X-error well both
 *  filled for the same series) — each drawn independently. A span with only
 *  one side present (should not happen for a wells-derived symmetric
 *  binding, but the shape is the general `ErrorSpan`) draws only that side,
 *  never inventing the other. */
export function drawErrorWhiskers(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  spans: readonly ErrorSpan[],
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const span of spans) {
    for (let r = 0; r < xs.length; r++) {
      const xv = xs[r];
      const yv = ys[r];
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      const plus = span.plus[r];
      const minus = span.minus[r];
      if (plus == null && minus == null) continue;
      const px = sx(xv);
      const py = sy(yv);
      ctx.beginPath();
      if (span.axis === "y") {
        const top = plus != null ? sy(yv + plus) : py;
        const bottom = minus != null ? sy(yv - minus) : py;
        ctx.moveTo(px, top);
        ctx.lineTo(px, bottom);
        ctx.moveTo(px - CAP, top);
        ctx.lineTo(px + CAP, top);
        ctx.moveTo(px - CAP, bottom);
        ctx.lineTo(px + CAP, bottom);
      } else {
        const left = minus != null ? sx(xv - minus) : px;
        const right = plus != null ? sx(xv + plus) : px;
        ctx.moveTo(left, py);
        ctx.lineTo(right, py);
        ctx.moveTo(left, py - CAP);
        ctx.lineTo(left, py + CAP);
        ctx.moveTo(right, py - CAP);
        ctx.lineTo(right, py + CAP);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
