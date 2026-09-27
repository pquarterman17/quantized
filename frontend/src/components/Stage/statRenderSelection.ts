// The linked row selection on the categorical statistics canvas
// (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 4, "summary table links to selected
// groups"). Pure geometry + paint, no React / store: the stage computes the
// marks (`statGroupSummary.selectionMarks`) from the app's ONE row selection
// and this module paints them, and maps a click back to a drawn slot.
//
// Every categorical renderer lays its drawn categories out on
// `categorySlots(count)` — slot i of n centred at (i + 0.5) / n of the plot
// width — whether or not the axis carries empty slots (`statRenderSlots`), so
// one band per drawn slot and one floor() for the hit test cover box, violin,
// strip and bar alike. Selected POINTS (box "points" / strip) are ringed by
// the box renderer itself (`statRenderBox`), which owns their jitter.

import { stackedTotal } from "../../lib/barlayout";
import { barValueDomain, finiteDomain } from "../../lib/statstage";
import type { Rect, StatDrawData } from "./statRender";
import { plotRect } from "./statRender";
import { slotPlan } from "./statRenderSlots";

/** Per drawn slot: 0 = nothing selected, 1 = some of its rows, 2 = all. */
export type SlotMark = 0 | 1 | 2;

export interface StatSelectionMarks {
  /** One per DRAWN category slot, in draw order. */
  slots: readonly SlotMark[];
  /** Whether this draw's raw-point overlay (box "points" / strip) has any
   *  point to ring — true exactly when `slots` has some non-zero mark
   *  (P2.6 review finding 4: a slot's mark is computed from the SAME rows
   *  its points are, so "some slot marked" and "some point selected" are one
   *  fact, not two). The renderer (`statRenderBox.drawJitteredPoints`) does
   *  NOT read the selected-rows Set through this field — it checks the live
   *  selection directly, via `CategoryAxisMarks.selectedRows` alongside this
   *  object, so a `StatSelectionMarks` never has to carry its own copy of a
   *  Set that is always either the whole selection or empty. */
  ringPoints: boolean;
}

/** A translucent accent band over every slot holding selected rows, with a
 *  solid (all) or dashed (some) rule along the category axis. */
export function drawSlotSelection(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  marks: StatSelectionMarks,
  accent: string,
) {
  const n = marks.slots.length;
  if (!n) return;
  const w = rect.w / n;
  ctx.save();
  marks.slots.forEach((m, i) => {
    if (m === 0) return;
    const x0 = rect.x + i * w;
    ctx.globalAlpha = m === 2 ? 0.14 : 0.07;
    ctx.fillStyle = accent;
    ctx.fillRect(x0, rect.y, w, rect.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.setLineDash(m === 2 ? [] : [4, 3]);
    ctx.beginPath();
    ctx.moveTo(x0 + 2, rect.y + rect.h - 1.5);
    ctx.lineTo(x0 + w - 2, rect.y + rect.h - 1.5);
    ctx.stroke();
  });
  ctx.restore();
}

/** The drawn slot under (x, y) in a `width` x `height` canvas holding `count`
 *  slots, or null outside the plot. The band below the plot (tick labels)
 *  counts too, so a click on a level's NAME picks it. Purely a geometric
 *  x-bucket + "is this row/column on the canvas at all" test — it does NOT
 *  know whether slot i actually drew anything at this y (see `clickedSlotAt`,
 *  which layers that check on top for the real click handler). */
export function slotIndexAt(width: number, height: number, x: number, y: number, count: number): number | null {
  if (count <= 0) return null;
  const rect = plotRect(width, height);
  if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > height) return null;
  return Math.min(count - 1, Math.max(0, Math.floor(((x - rect.x) / rect.w) * count)));
}

/** Slot `slotIndex`'s drawn content, as a [top, bottom] PIXEL y-range in
 *  `rect` — the box/violin/bar body, its whisker/error-bar span, and (box)
 *  any fliers or mean-CI marker shown, i.e. everything `statRenderBox.ts` /
 *  `statRender.ts`'s `drawViolins` / `statRenderBar.ts` actually paint there.
 *  Null for an empty slot (nothing drawn in the plot rect — only its tick
 *  label is content) or a mode with no per-slot content of its own (qq,
 *  histogram never reach this: `StatStageCanvas` only passes a `slotCount`
 *  for a categorical draw). Reuses the SAME domain math the renderers do
 *  (`finiteDomain`/`barValueDomain`, `slotPlan`) so a click can never
 *  disagree with what was painted (P2.6 review finding 10). */
function slotContentPixelRange(data: StatDrawData, rect: Rect, slotIndex: number): [number, number] | null {
  const span = (lo: number, hi: number, domain: [number, number]): [number, number] => {
    const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;
    return [Math.min(vy(lo), vy(hi)), Math.max(vy(lo), vy(hi))];
  };
  switch (data.mode) {
    case "box": {
      if (!data.boxes.length) return null;
      const plan = slotPlan(data.slots, data.boxes.map((b) => b.label));
      const gi = plan.groupSlot.indexOf(slotIndex);
      if (gi < 0) return null; // an empty slot: no box drawn
      const b = data.boxes[gi];
      const ciExtents = data.showMeanCI
        ? data.boxes.flatMap((x) => [x.ciLo, x.ciHi]).filter((v): v is number => Number.isFinite(v))
        : [];
      const domain = finiteDomain([...data.boxes.map((x) => [x.whislo, x.whishi, ...x.fliers]), ciExtents]);
      const own = [b.whislo, b.whishi, ...b.fliers, ...(data.showMeanCI ? [b.ciLo, b.ciHi] : [])].filter((v): v is number =>
        Number.isFinite(v),
      );
      if (!own.length) return null;
      return span(Math.min(...own), Math.max(...own), domain);
    }
    case "strip": {
      if (!data.points.length) return null;
      const plan = slotPlan(data.slots, data.points.map((g) => g.label));
      const gi = plan.groupSlot.indexOf(slotIndex);
      if (gi < 0) return null;
      const g = data.points[gi];
      if (!g.points.length) return null;
      const valueLists = data.points.map((gr) => gr.points.map((p) => p.value));
      const ciExtents = data.showMeanCI
        ? data.boxes.flatMap((x) => [x.ciLo, x.ciHi]).filter((v): v is number => Number.isFinite(v))
        : [];
      const domain = finiteDomain([...valueLists, ciExtents]);
      const vals = g.points.map((p) => p.value);
      return span(Math.min(...vals), Math.max(...vals), domain);
    }
    case "violin": {
      if (!data.violins.length) return null;
      const plan = slotPlan(data.slots, data.violins.map((v) => v.label));
      const gi = plan.groupSlot.indexOf(slotIndex);
      if (gi < 0) return null;
      const v = data.violins[gi];
      const lo = v.x[0];
      const hi = v.x[v.x.length - 1];
      if (lo === undefined || hi === undefined) return null;
      const domain = finiteDomain(data.violins.map((vv) => [vv.x[0] ?? 0, vv.x[vv.x.length - 1] ?? 0]));
      return span(lo, hi, domain);
    }
    case "bar": {
      const groups = data.data.groups;
      const g = groups[slotIndex];
      if (!g || g.series.every((s) => s.n === 0)) return null; // an empty slot
      const candidates: number[] = [0];
      groups.forEach((gr) => {
        if (data.stacked) {
          candidates.push(stackedTotal(gr.series));
        } else {
          gr.series.forEach((s) => {
            if (!Number.isFinite(s.mean)) return;
            candidates.push(s.mean);
            if (Number.isFinite(s.sem)) candidates.push(s.mean + s.sem, s.mean - s.sem);
          });
        }
      });
      const domain = barValueDomain(candidates);
      if (data.stacked) {
        const total = stackedTotal(g.series);
        const last = g.series[g.series.length - 1];
        const sem = last && Number.isFinite(last.sem) ? last.sem : 0;
        return span(Math.min(0, total - sem), total + sem, domain);
      }
      let lo = 0;
      let hi = 0;
      g.series.forEach((s) => {
        if (!Number.isFinite(s.mean)) return;
        const sem = Number.isFinite(s.sem) ? s.sem : 0;
        lo = Math.min(lo, s.mean - sem);
        hi = Math.max(hi, s.mean + sem);
      });
      return span(lo, hi, domain);
    }
    default:
      return null;
  }
}

/** The slot a click at (x, y) actually lands ON: `slotIndexAt`'s x-bucket,
 *  narrowed to where slot content is really drawn (P2.6 review finding 10) —
 *  a click on background between/above/below the glyphs (blank space inside
 *  the plot rect) selects nothing, while a click ANYWHERE in the tick-label
 *  band below the plot still picks that slot (a level's NAME is content
 *  too), matching `slotIndexAt`'s own existing band rule. */
export function clickedSlotAt(
  data: StatDrawData,
  width: number,
  height: number,
  x: number,
  y: number,
  count: number,
): number | null {
  const i = slotIndexAt(width, height, x, y, count);
  if (i === null) return null;
  const rect = plotRect(width, height);
  if (y > rect.y + rect.h) return i; // the tick-label band: always content
  const extent = slotContentPixelRange(data, rect, i);
  return extent && y >= extent[0] && y <= extent[1] ? i : null;
}
