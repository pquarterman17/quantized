// Paints the significance brackets / compact letters of a categorical draw
// (gap audit 8 lane SIG). The geometry is already laid out in the plot's own
// units (`statCompareLayout`: axis slot + value y), so this only maps it to
// pixels; the export draws the same geometry (`calc.figure_stat_comparisons`).

import type { ComparisonMarks } from "../../lib/statComparisons";
import type { CategorySlot } from "../../lib/statstage";
import type { Rect } from "./statRender";

/** Brackets (a line with two end ticks and its label above) and letters, in
 *  `ink`, over the plot rect. `slots` is the axis's slot list, `vy` the value
 *  -> pixel map the glyphs were drawn with. */
export function drawComparisons(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  slots: readonly CategorySlot[],
  vy: (v: number) => number,
  c: ComparisonMarks | null | undefined,
  ink: string,
) {
  if (!c || (!c.brackets.length && !c.letters.length)) return;
  const sx = (slot: number) => rect.x + slots[slot].cx * rect.w;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const b of c.brackets) {
    if (!slots[b.a] || !slots[b.b]) continue;
    const x1 = sx(b.a);
    const x2 = sx(b.b);
    const y = vy(b.y);
    const yt = vy(b.y - c.tick);
    ctx.beginPath();
    ctx.moveTo(x1, yt);
    ctx.lineTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.lineTo(x2, yt);
    ctx.stroke();
    ctx.fillText(b.label, (x1 + x2) / 2, y - 1);
  }
  for (const l of c.letters) {
    if (slots[l.slot]) ctx.fillText(l.text, sx(l.slot), vy(l.y));
  }
  ctx.restore();
}
