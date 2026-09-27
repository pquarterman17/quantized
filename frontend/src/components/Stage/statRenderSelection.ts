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

import type { Rect } from "./statRender";
import { plotRect } from "./statRender";

/** Per drawn slot: 0 = nothing selected, 1 = some of its rows, 2 = all. */
export type SlotMark = 0 | 1 | 2;

export interface StatSelectionMarks {
  /** One per DRAWN category slot, in draw order. */
  slots: readonly SlotMark[];
  /** Selected rows in the draw's point index space (the analysis view the
   *  points' `rowIndex` counts in — NOT original dataset rows). */
  points: ReadonlySet<number>;
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
 *  counts too, so a click on a level's NAME picks it. */
export function slotIndexAt(width: number, height: number, x: number, y: number, count: number): number | null {
  if (count <= 0) return null;
  const rect = plotRect(width, height);
  if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > height) return null;
  return Math.min(count - 1, Math.max(0, Math.floor(((x - rect.x) / rect.w) * count)));
}
