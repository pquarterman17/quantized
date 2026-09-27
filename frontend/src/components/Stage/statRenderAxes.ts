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

import { LABEL_WRAP_WIDTH, MAX_WRAP_LINES, nestedTiers, wrapLabel, type TierRun } from "../../lib/statMarks";
import type { Rect } from "./statRender";

/** Label options, as the draw carries them (absent = none). */
export interface CategoryAxisStyle {
  rotation?: 0 | 45 | 90;
  wrap?: boolean;
  /** Review finding 4: the nest column's display name when the axis IS
   *  structurally nested (`StatDrawData.nestLabel`), null/absent otherwise
   *  — never inferred from the label text itself. */
  nestLabel?: string | null;
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
  /** Review finding 7: the rotation ACTUALLY used — `style.rotation` unless
   *  capping (`maxBottom`) dropped it to fit. The painter reads THIS, never
   *  `style.rotation` directly, so a degraded layout's `depth`/`captionY`
   *  and its own rotated-text drawing can never disagree about which
   *  rotation the numbers above describe. */
  rotation: 0 | 45 | 90;
}

/** One geometry attempt at (`wrap`, `maxLines`, `rotation`) — the pure inner
 *  half of `categoryAxisLayout`'s degrade ladder below. */
function buildLayout(
  texts: readonly string[],
  wrap: boolean,
  maxLines: number,
  rot: 0 | 45 | 90,
  tiered: boolean,
): Omit<CategoryAxisLayout, "tiers"> {
  const lines = texts.map((t) => (wrap ? wrapLabel(t, LABEL_WRAP_WIDTH, maxLines) : [truncateLabel(t)]));
  const nLines = Math.max(1, ...lines.map((l) => l.length));
  const longest = Math.max(0, ...lines.flat().map((l) => Array.from(l).length));
  const theta = (rot * Math.PI) / 180;
  const depth =
    rot === 0 ? nLines * LINE : Math.ceil(longest * CHAR_W * Math.sin(theta) + nLines * LINE * Math.cos(theta));
  const captionY = TOP + depth + (tiered ? TIER : 0) + CAPTION;
  return { lines, depth, captionY, bottom: Math.max(48, captionY + 18), rotation: rot };
}

function computeCategoryAxisLayout(
  labels: readonly string[], style: CategoryAxisStyle, maxBottom: number | undefined,
): CategoryAxisLayout {
  const tiered = nestedTiers(labels, style.nestLabel);
  const texts = tiered ? tiered.inner : labels;
  const wrap = style.wrap ?? false;
  const rot = style.rotation ?? 0;
  let built = buildLayout(texts, wrap, MAX_WRAP_LINES, rot, tiered != null);
  if (maxBottom != null && built.bottom > maxBottom) {
    const attempts: [boolean, number, 0 | 45 | 90][] = wrap
      ? [[wrap, 2, rot], [wrap, 1, rot], [false, 1, rot], [false, 1, 0]]
      : [[wrap, 1, 0]];
    for (const [w2, ml, r2] of attempts) {
      built = buildLayout(texts, w2, ml, r2, tiered != null);
      if (built.bottom <= maxBottom) break;
    }
    // Still over (an extreme canvas): clamp outright so the painter and the
    // hit-test/`plotRect` cap agree on ONE number even though the text
    // itself may then sit tight against the canvas edge.
    if (built.bottom > maxBottom) {
      const bottom = Math.max(48, maxBottom);
      const shrink = bottom - built.bottom;
      built = {
        ...built, bottom, depth: Math.max(0, built.depth + shrink), captionY: Math.max(0, built.captionY + shrink),
      };
    }
  }
  return { ...built, tiers: tiered?.runs ?? null };
}

// Review finding 10: a size-1 memo keyed on the layout's own inputs. Every
// click/hover hit-test (`statRenderSelection.ts`, via `statRender.plotRect`)
// asks for the SAME draw's layout over and over between renders — without
// this, each one re-wrapped/re-measured every label from scratch. A real
// render always passes the CURRENT draw's inputs first (paint happens before
// any click can), so the common case (repeated clicks, no re-render between
// them) is a single string-key compare, not a re-layout; a genuinely new
// draw/size still invalidates and recomputes exactly once, byte-identical.
let lastLayoutKey: string | null = null;
let lastLayoutResult: CategoryAxisLayout | null = null;

/** The whole axis's geometry for these labels and options — pure (memoized
 *  by its own inputs; see the module note above).
 *
 *  Review finding 7: `maxBottom` (the plot rect's own cap, `h * 0.45`) is
 *  optional so every EXISTING caller (canvas paint, hit-test, and every
 *  test that predates the cap) keeps its byte-identical layout; `plotRect`
 *  passes it, which makes ITS capped margin and THIS layout's `depth` /
 *  `captionY` / `bottom` the SAME numbers by construction — no second
 *  `Math.min` anywhere else can drift from it. When the natural layout
 *  would not fit, wrapping is shortened and then rotation dropped (in that
 *  order — rotation is usually the larger depth driver) before finally
 *  clamping outright, so a pathologically short canvas still gets a
 *  consistent (if tight) number rather than an uncapped one nothing else
 *  agrees with. */
export function categoryAxisLayout(
  labels: readonly string[], style: CategoryAxisStyle = {}, maxBottom?: number,
): CategoryAxisLayout {
  const key = JSON.stringify([labels, style.rotation, style.wrap, style.nestLabel, maxBottom]);
  if (key === lastLayoutKey && lastLayoutResult) return lastLayoutResult;
  const result = computeCategoryAxisLayout(labels, style, maxBottom);
  lastLayoutKey = key;
  lastLayoutResult = result;
  return result;
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
  // Review finding 7: `rect.maxBottom` (set by `plotRect`) — the SAME cap,
  // so a degraded layout here is the IDENTICAL one the rect's own margin
  // was sized from, never an uncapped one that overruns the canvas.
  const layout = categoryAxisLayout(labels, style, rect.maxBottom);
  const base = rect.y + rect.h + TOP;
  const rot = layout.rotation; // NOT style.rotation -- capping may have dropped it
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
