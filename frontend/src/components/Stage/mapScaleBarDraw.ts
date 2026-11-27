// The 2-D map's scale bar on the canvas (`MapViewState.scaleBar`, set in the
// Inspector's "2-D map" card): a bar in the map's X data units in one corner of
// the plot area with its label under it. Length, label and placement come from
// `lib/mapScaleBar.ts`; the vector export draws the same bar
// (`calc/figure_map_scalebar.py`).
import { BAR_PX, resolveScaleBar, scaleBarLayout } from "../../lib/mapScaleBar";
import type { MapScaleBar } from "../../lib/mapScaleBarOptions";
import type { MapPayload } from "../../lib/mapdataFetch";

export const SCALE_BAR_FONT_PX = 11;

export function drawMapScaleBar(
  ctx: CanvasRenderingContext2D,
  p: MapPayload,
  rect: { x: number; y: number; w: number; h: number },
  bar: MapScaleBar,
): void {
  const span = Math.abs(p.xAxis[p.xAxis.length - 1] - p.xAxis[0]);
  const r = resolveScaleBar(bar, span, p.xUnit);
  if (!r) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.font = `${SCALE_BAR_FONT_PX}px 'JetBrains Mono', monospace`;
  const m = ctx.measureText(r.text) as TextMetrics | undefined; // undefined: a bare test stub
  const lay = scaleBarLayout(bar.corner, rect.w, rect.h, (r.length / span) * rect.w, m?.width ?? 0, SCALE_BAR_FONT_PX * 1.2);
  ctx.strokeStyle = bar.color;
  ctx.fillStyle = bar.color;
  ctx.lineWidth = BAR_PX;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(rect.x + lay.x0, rect.y + lay.y);
  ctx.lineTo(rect.x + lay.x1, rect.y + lay.y);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(r.text, rect.x + lay.labelLeft, rect.y + lay.labelTop);
  ctx.restore();
}
