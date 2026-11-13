// Region-shade drawing and the off-scale reference-line marker — a LAZY
// chunk (eager-bundle budget). `lib/uplotOverlays.ts` keeps the eager plugin
// shells (`regionShadePlugin`, `refLinePlugin`) and starts loading this module
// the moment it loads — app startup, long before a plot can carry a shade —
// and every draw after that uses it; a draw in the brief window before it
// lands paints no shade/marker, and the next redraw does.
//
// Publication-figures audit #11: a shade inserted with the old default
// y1 = 0 .. y2 = 1 was invisible on a log axis (0 has no position, so the
// whole rect was skipped) and the export dropped it the same way. A
// `fullHeight` shade spans the plot height in AXES terms — what an x-range
// highlight almost always means — and is the default for a new shade; a
// data-y shade on a log/reciprocal axis with a side <= 0 runs from the plot
// floor instead of vanishing. `calc/figure_decor.py` applies the same rule
// to the export (and reports what it still cannot show). An off-scale
// reference line is named at the plot edge it lies beyond.

import type uPlot from "uplot";

import type { RefLine, RegionShade } from "./types";
import { REGION_SHADE_ALPHA } from "./uplotOverlays";

/** A shade's vertical extent in canvas px: the full plot height, or its y
 *  values on the shade's scale — a value with no position on a positive-only
 *  scale (log/reciprocal, y <= 0) reads as the plot floor. Null when nothing
 *  of it can be placed. */
function shadeYSpan(u: uPlot, s: RegionShade, yScale: string): [number, number] | null {
  const { top, height } = u.bbox;
  if (s.fullHeight) return [top, top + height];
  const floor = top + height;
  const ya = u.valToPos(s.y1, yScale, true);
  const yb = u.valToPos(s.y2, yScale, true);
  if (!Number.isFinite(ya) && !Number.isFinite(yb)) return null;
  return [Number.isFinite(ya) ? ya : floor, Number.isFinite(yb) ? yb : floor];
}

/** `regionShadePlugin`'s drawClear body (see that shell's doc in
 *  lib/uplotOverlays.ts for the z-order and axis rules). */
export function drawRegionShades(u: uPlot, shades: readonly RegionShade[]): void {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const hasY2 = u.scales.y2 != null;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.globalAlpha = REGION_SHADE_ALPHA;
  for (const s of shades) {
    if (![s.x1, s.x2].every(Number.isFinite)) continue;
    if (!s.fullHeight && ![s.y1, s.y2].every(Number.isFinite)) continue;
    const yScale = s.axis === 1 && hasY2 ? "y2" : "y";
    const xa = u.valToPos(s.x1, "x", true);
    const xb = u.valToPos(s.x2, "x", true);
    const ys = shadeYSpan(u, s, yScale);
    if (!ys || ![xa, xb].every(Number.isFinite)) continue;
    const [ya, yb] = ys;
    ctx.fillStyle = s.fill;
    ctx.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
  }
  ctx.restore();
}

/** A reference line whose value is off the current scale draws nothing, so
 *  mark it at the plot edge it lies beyond ("x = 12 ▸") instead of leaving
 *  the user to wonder where it went (audit #11). `side` is that edge. */
export function drawOffScaleRefLine(
  ctx: CanvasRenderingContext2D,
  ln: Pick<RefLine, "axis" | "label">,
  value: number,
  side: "low" | "high",
  bbox: { left: number; top: number; width: number; height: number },
): void {
  const name = ln.label || `${ln.axis} = ${Number(value.toPrecision(4))}`;
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.85;
  if (ln.axis === "x") {
    const text = side === "low" ? `◂ ${name} (off-scale)` : `${name} (off-scale) ▸`;
    // Along the BOTTOM edge: the legend usually sits in a top corner and hid
    // a top-edge marker in the live check.
    ctx.textAlign = side === "low" ? "left" : "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(text, side === "low" ? bbox.left + 4 : bbox.left + bbox.width - 4, bbox.top + bbox.height - 4);
  } else {
    // Canvas y grows downward: a value above the scale ("high") sits at the
    // top. Left-aligned, away from a top-right legend.
    const text = `${side === "high" ? "▴" : "▾"} ${name} (off-scale)`;
    ctx.textAlign = "left";
    ctx.textBaseline = side === "high" ? "top" : "bottom";
    const y = side === "high" ? bbox.top + 4 : bbox.top + bbox.height - 4;
    ctx.fillText(text, bbox.left + 4, y);
  }
  ctx.restore();
}
