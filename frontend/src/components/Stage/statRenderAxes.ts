// The CATEGORY axis for the Canvas2D statistical stage: the tick labels under
// each box/violin/strip/bar slot, plus the label-fitting rules they share.
//
// Split out of `statRender.ts` when Group R's nested-label fix pushed that file
// past its line pin. It is a genuine unit rather than a convenient offcut: the
// truncation budget, wrapping, rotation and the nested two-tier layout are one
// decision about how much of a category's name can reach the screen, and this
// is the only painter that makes it.
//
// P2.6 box 1 — the export twin is `calc.figure_category_axis.
// style_category_axis`, fed the same options (`lib/statMarks.axisStyleWire`):
//   * a NESTED axis (every label `A = a / B = b`) is drawn in TWO TIERS — the
//     inner level under each tick, each outer level once, centred under its
//     run, with a separator between runs. (Group R first stacked both halves
//     under every tick, so `lot = 0` repeated under each of its wafers; the
//     second factor still reaches the screen, now without the repetition.)
//   * `wrap` breaks a label into lines (`lib/statMarks.wrapLabel`, the
//     export's `wrap_label` line for line) instead of truncating it;
//   * `rotation` 45 / 90 turns the labels, anchored at their END on the tick,
//     as matplotlib's `ha="right"` + `rotation_mode="anchor"` (45) and
//     centred rotation (90) do.
// The axis's DEPTH (`categoryAxisLayout`) is what the plot rect's bottom
// margin is sized from, so the layout, the painter and the click hit-test
// (`statRenderSelection`) cannot disagree about where the plot ends.

import { nestedTiers, wrapLabel, type TierRun } from "../../lib/statMarks";
import type { Rect } from "./statRender";

/** Label options, as the draw carries them (absent = none). */
export interface CategoryAxisStyle {
  rotation?: 0 | 45 | 90;
  wrap?: boolean;
}

const LINE = 11; // px per 10px label line
const CHAR_W = 6; // JetBrains Mono 10px advance, px
const TOP = 6; // tick-label offset below the plot rect
const TIER = 14; // the outer tier's row
const CAPTION = 13; // gap from the labels to the axis caption

function truncateLabel(s: string, max = 14): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface CategoryAxisLayout {
  /** Lines drawn at each tick (inner labels when tiered). */
  lines: string[][];
  tiers: TierRun[] | null;
  /** How far below the rect the tick labels reach, px. */
  depth: number;
  /** Caption baseline offset below the rect, px. */
  captionY: number;
  /** The bottom margin the plot rect needs, px. */
  bottom: number;
}

/** The whole axis's geometry for these labels and options — pure. */
export function categoryAxisLayout(labels: readonly string[], style: CategoryAxisStyle = {}): CategoryAxisLayout {
  const tiered = nestedTiers(labels);
  const texts = tiered ? tiered.inner : labels;
  const lines = texts.map((t) => (style.wrap ? wrapLabel(t) : [truncateLabel(t)]));
  const nLines = Math.max(1, ...lines.map((l) => l.length));
  const longest = Math.max(0, ...lines.flat().map((l) => Array.from(l).length));
  const rot = style.rotation ?? 0;
  const theta = (rot * Math.PI) / 180;
  const depth =
    rot === 0 ? nLines * LINE : Math.ceil(longest * CHAR_W * Math.sin(theta) + nLines * LINE * Math.cos(theta));
  const captionY = TOP + depth + (tiered ? TIER : 0) + CAPTION;
  return { lines, tiers: tiered?.runs ?? null, depth, captionY, bottom: Math.max(48, captionY + 18) };
}

export function drawCategoryAxis(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  slots: { cx: number }[],
  labels: string[],
  caption: string,
  ink: string,
  muted: string,
  style: CategoryAxisStyle = {},
) {
  const layout = categoryAxisLayout(labels, style);
  const base = rect.y + rect.h + TOP;
  const rot = style.rotation ?? 0;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = muted;
  slots.forEach((s, i) => {
    const sx = rect.x + s.cx * rect.w;
    const lines = layout.lines[i] ?? [""];
    if (rot === 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      lines.forEach((line, li) => ctx.fillText(line, sx, base + li * LINE));
      return;
    }
    // Rotated: the label's END sits on the tick (matplotlib ha="right").
    ctx.save();
    ctx.translate(sx, base);
    ctx.rotate((-rot * Math.PI) / 180);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    lines.forEach((line, li) => ctx.fillText(line, 0, (li - (lines.length - 1) / 2) * LINE));
    ctx.restore();
  });
  if (layout.tiers) drawOuterTier(ctx, rect, slots, layout, muted);
  ctx.fillStyle = ink;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(caption, rect.x + rect.w / 2, rect.y + rect.h + layout.captionY);
}

/** The nested axis's second tier: each outer level once, centred under its
 *  run, and a separator from the axis line down to the tier between runs. */
function drawOuterTier(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  slots: { cx: number }[],
  layout: CategoryAxisLayout,
  muted: string,
) {
  const runs = layout.tiers ?? [];
  const x = (i: number) => rect.x + (slots[i]?.cx ?? 0) * rect.w;
  const bottom = rect.y + rect.h;
  const tierY = bottom + TOP + layout.depth + 2;
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  runs.slice(0, -1).forEach((r) => {
    const sep = (x(r.last) + x(r.last + 1)) / 2;
    ctx.moveTo(sep, bottom);
    ctx.lineTo(sep, tierY + LINE);
  });
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const pitch = slots.length ? rect.w / slots.length : rect.w;
  for (const r of runs) {
    const span = (r.last - r.first + 1) * pitch;
    ctx.fillText(truncateLabel(r.label, Math.max(4, Math.floor(span / CHAR_W))), (x(r.first) + x(r.last)) / 2, tierY);
  }
}
