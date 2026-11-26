// The measurement annotations on the canvas: slope (with the power-law exponent
// on log axes and an optional slope triangle), distance, three-point angle and
// scale bar. They are `Shape` kinds drawn by `lib/uplotShapes.ts`'s plugin,
// which hands the four kinds to `drawMeasureShape` here; the label text comes
// from `lib/annotationMeasure.ts`, and `calc/figure_measure_shapes.py` draws
// the same marks in the export (one table pins both:
// `tests/fixtures/wire/annotation_measures.json`).
import type uPlot from "uplot";

import { labelBelow, scalebarGeometry, shapeLabel } from "./annotationMeasure";
import { isMeasureKind } from "./shapeMeasureFields";
import type { Shape } from "./types";

export { isMeasureKind };

/** A scale bar reads as a bar: twice the hairline width (the export agrees). */
export function defaultMeasureWidth(kind: Shape["kind"]): number {
  return kind === "scalebar" ? 3 : 1.5;
}

export interface MeasureStyle {
  stroke: string;
  opacity: number;
  width: number;
  dash: number[];
}

interface Px {
  x1: number; y1: number; x2: number; y2: number; x3?: number; y3?: number;
}

const TRIANGLE_FILL = 0.15; // of the shape's opacity
const TRIANGLE_EDGE = 0.7; // of the shape's width
const DOT_R = 3;

/** Is this axis logarithmic (uPlot distr 3)? */
export function axisIsLog(u: Pick<uPlot, "scales">, key: "x" | "y"): boolean {
  return u.scales[key]?.distr === 3;
}

/** Shape the draw gesture's raw drag into the kind's own geometry. A scale bar
 *  snaps to the horizontal or vertical (whichever the drag is closer to, in
 *  pixels); an angle's second arm starts along the horizontal, as long as the
 *  first (the user then drags its handle). Other kinds are unchanged. */
export function snapDraw(
  u: Pick<uPlot, "valToPos" | "posToVal">,
  kind: string,
  x1: number, y1: number, x2: number, y2: number,
): { x2: number; y2: number; x3?: number; y3?: number } {
  if (kind === "scalebar") {
    const dx = Math.abs(u.valToPos(x2, "x") - u.valToPos(x1, "x"));
    const dy = Math.abs(u.valToPos(y2, "y") - u.valToPos(y1, "y"));
    return dx >= dy ? { x2, y2: y1 } : { x2: x1, y2 };
  }
  if (kind === "angle") {
    const px1 = u.valToPos(x1, "x");
    const arm = Math.hypot(u.valToPos(x2, "x") - px1, u.valToPos(y2, "y") - u.valToPos(y1, "y"));
    return { x2, y2, x3: u.posToVal(px1 + arm, "x"), y3: y1 };
  }
  return { x2, y2 };
}

function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  align: CanvasTextAlign, baseline: CanvasTextBaseline, color: string,
): void {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
}

/** Draw one measurement shape. `l` is its canvas-pixel layout (the shape's own
 *  `x1..y3`, resolved by `uplotShapes.shapeLayout`); `font` is the plot's base
 *  CSS font, as the text annotations use. */
export function drawMeasureShape(
  u: Pick<uPlot, "valToPos" | "scales">,
  ctx: CanvasRenderingContext2D,
  s: Shape,
  l: Px,
  style: MeasureStyle,
  font: string,
): void {
  const text = shapeLabel(s, axisIsLog(u, "x"), axisIsLog(u, "y")) ?? "";
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash);
  ctx.font = font;
  const dot = (x: number, y: number) => {
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = style.stroke;
    ctx.beginPath();
    ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  if (s.kind === "slope" || s.kind === "distance") {
    if (s.kind === "slope" && s.triangle) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.closePath();
      ctx.globalAlpha = style.opacity * TRIANGLE_FILL;
      ctx.fillStyle = style.stroke;
      ctx.fill();
      ctx.globalAlpha = style.opacity;
      ctx.lineWidth = style.width * TRIANGLE_EDGE;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
    if (s.kind === "distance") {
      dot(l.x1, l.y1);
      dot(l.x2, l.y2);
    }
    const below = labelBelow(s.x1, s.y1, s.x2, s.y2);
    drawText(ctx, text, (l.x1 + l.x2) / 2 + 6, (l.y1 + l.y2) / 2 + (below ? 6 : -6), "left", below ? "top" : "bottom", style.stroke);
  } else if (s.kind === "angle") {
    const x3 = l.x3 ?? l.x1;
    const y3 = l.y3 ?? l.y1;
    ctx.beginPath();
    ctx.moveTo(l.x2, l.y2);
    ctx.lineTo(l.x1, l.y1);
    ctx.lineTo(x3, y3);
    ctx.stroke();
    dot(l.x1, l.y1);
    drawText(ctx, text, l.x1 + 8, l.y1 - 8, "left", "bottom", style.stroke);
  } else {
    const g = scalebarGeometry(s);
    const ex = u.valToPos(g.ex, "x", true);
    const ey = u.valToPos(g.ey, "y", true);
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    const mx = (l.x1 + ex) / 2;
    const my = (l.y1 + ey) / 2;
    if (g.orient === "v") drawText(ctx, text, mx + 8, my, "left", "middle", style.stroke);
    else drawText(ctx, text, mx, my + 6, "center", "top", style.stroke);
  }
  ctx.restore();
}
