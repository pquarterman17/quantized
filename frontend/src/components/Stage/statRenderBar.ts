// Bar (gap #20 categorical plots: grouped / stacked, error bars) for the
// Canvas2D statistical stage. Moved out of `statRender.ts` (P2.6 box 2) — that
// dispatcher sat on its line pin, and the missing-level work changes this
// painter more than any other:
//
//   * a series with NO finite value in a category (mean NaN, n=0) draws no bar
//     at all. It used to draw a 1-pixel bar at zero, which reads as "the mean
//     is 0" — a missing value dressed up as a measurement;
//   * a category whose every series is empty is an EMPTY slot, marked `n=0`
//     mid-panel exactly like the box family's (`statRenderSlots`), and
//     `calc.figure_categorical` does the same on export;
//   * `n=` captions are gated by `showN` and sit above the error whisker
//     (`lib/groupAxis.barCountAnchor`, the export's rule too).

import { groupedBarSlots, stackedSegments, stackedTotal } from "../../lib/barlayout";
import { barCountAnchor } from "../../lib/groupAxis";
import { barValueDomain, categorySlots } from "../../lib/statstage";
import { seriesColor } from "../../lib/uplotOpts";
import { drawValueAxis, type Rect, type StatDrawData } from "./statRender";
import { drawCategoryAxis } from "./statRenderAxes";
import { drawCountLabel, drawEmptySlotMarkers } from "./statRenderSlots";

/** A vertical error-bar whisker (± SEM) with end caps, matching box mode's
 *  whisker/cap drawing. */
function drawWhisker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  yLo: number,
  yHi: number,
  capHalfWidth: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(cx, yLo);
  ctx.lineTo(cx, yHi);
  ctx.moveTo(cx - capHalfWidth, yLo);
  ctx.lineTo(cx + capHalfWidth, yLo);
  ctx.moveTo(cx - capHalfWidth, yHi);
  ctx.lineTo(cx + capHalfWidth, yHi);
  ctx.stroke();
}

export function drawBar(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "bar" }>,
  ink: string,
  muted: string,
) {
  const groups = d.data.groups;
  if (!groups.length) return;
  const nSeries = d.data.seriesLabels.length;

  // Domain candidates: every drawn extent (bar top/bottom ± error), always
  // including 0 (barValueDomain's job).
  const candidates: number[] = [0];
  groups.forEach((g) => {
    if (d.stacked) {
      candidates.push(stackedTotal(g.series));
      const last = g.series[g.series.length - 1];
      if (last && Number.isFinite(last.sem)) {
        candidates.push(stackedTotal(g.series) + last.sem, stackedTotal(g.series) - last.sem);
      }
    } else {
      g.series.forEach((s) => {
        if (!Number.isFinite(s.mean)) return;
        candidates.push(s.mean);
        if (Number.isFinite(s.sem)) candidates.push(s.mean + s.sem, s.mean - s.sem);
      });
    }
  });
  const domain = barValueDomain(candidates);
  drawValueAxis(ctx, rect, domain, d.valueLabel, ink, muted);
  const slots = categorySlots(groups.length);
  drawCategoryAxis(ctx, rect, slots, groups.map((g) => g.label), d.groupLabel, ink, muted);
  const empty = groups.flatMap((g, i) => (g.series.every((s) => s.n === 0) ? [i] : []));
  drawEmptySlotMarkers(ctx, rect, { labels: [], slots, groupSlot: [], empty }, muted);
  const showN = d.showN !== false;

  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;

  groups.forEach((g, gi) => {
    const slot = slots[gi];
    const cx = rect.x + slot.cx * rect.w;
    const catFullW = slot.halfWidth * 2 * rect.w;

    if (d.stacked) {
      const hw = slot.halfWidth * 0.85 * rect.w;
      const segs = stackedSegments(g.series);
      segs.forEach((seg, si) => {
        if (!Number.isFinite(g.series[si].mean)) return;
        const color = seriesColor(si);
        const yTop = vy(seg.top);
        const yBot = vy(seg.base);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = color;
        ctx.fillRect(cx - hw, yTop, hw * 2, Math.max(1, yBot - yTop));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - hw, yTop, hw * 2, Math.max(1, yBot - yTop));
      });
      const last = g.series[g.series.length - 1];
      if (last && Number.isFinite(last.sem)) {
        const top = stackedTotal(g.series);
        drawWhisker(ctx, cx, vy(top + last.sem), vy(top - last.sem), hw * 0.5, ink);
      }
    } else {
      const subSlots = groupedBarSlots(nSeries);
      g.series.forEach((s, si) => {
        const sub = subSlots[si];
        const barCx = cx + sub.offset * catFullW;
        const hw = sub.halfWidth * catFullW;
        if (showN) drawCountLabel(ctx, barCx, vy(barCountAnchor(s.mean, s.sem)), s.n, muted);
        if (!Number.isFinite(s.mean)) return;
        const color = seriesColor(si);
        const yTop = vy(Math.max(s.mean, 0));
        const yBot = vy(Math.min(s.mean, 0));
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = color;
        ctx.fillRect(barCx - hw, yTop, hw * 2, Math.max(1, yBot - yTop));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(barCx - hw, yTop, hw * 2, Math.max(1, yBot - yTop));
        if (Number.isFinite(s.sem)) {
          drawWhisker(ctx, barCx, vy(s.mean + s.sem), vy(s.mean - s.sem), hw * 0.6, ink);
        }
      });
    }
  });
}
