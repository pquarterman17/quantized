// Rich-text canvas renderer (GOTO #5, widened by MAIN #28): measure + draw a
// `richtext` AST on a CanvasRenderingContext2D. Sub/superscripts render at 0.7x
// the current size with a ±0.35 em baseline shift (em of the CURRENT level, so
// nested scripts scale and shift multiplicatively); italics via the CSS
// font-style slot; Greek / Å / ° / relations are plain Unicode codepoints (the
// parser already substituted them). Fractions stack numerator over denominator
// across a rule on the math axis; radicals draw a hand-stroked √ + overline
// sized to the radicand. Rotation (the y-axis label) is the CALLER's job:
// rotate the ctx and draw at the transformed origin — see uplotRichLabels.
//
// The renderer tracks a vertical BOX (width + ascent + descent, em-relative to
// the alphabetic baseline) per node so multi-line constructs can be centered
// and stacked; `measureRich` returns just the advance width for back-compat,
// `measureRichBox` the full box.
//
// WYSIWYG note (honest limits vs matplotlib mathtext): mathtext positions
// glyphs with real font metrics and italic-corrected kerning; this renderer
// uses fixed em conventions (0.7x scripts, a 0.28-em fraction axis, a
// hand-stroked radical), so glyph-level spacing differs by ~a px at typical
// label sizes while reading identically. A `x^2_3` base gets its scripts drawn
// SEQUENTIALLY (sup then sub, advancing right), not stacked in one column as
// TeX does.

import type { RichNode } from "./richtext";

/** Base font for a rich-text run (CSS pixel size; family list as in CSS). */
export interface RichFont {
  px: number;
  family: string;
  /** CSS font-weight slot (e.g. "600"); omitted = normal. */
  weight?: string;
}

/** The ctx subset used — lets tests pass a lightweight mock. `stroke*`/path
 *  ops draw the fraction rule and radical (only touched when drawing). */
export type RichTextCtx = Pick<
  CanvasRenderingContext2D,
  | "font"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "textAlign"
  | "textBaseline"
  | "fillText"
  | "measureText"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
>;

export const SCRIPT_SCALE = 0.7;
export const SCRIPT_SHIFT_EM = 0.35;

/** Approximate UI-font vertical metrics (em) for converting a top/bottom
 *  canvas-text-baseline convention into `drawRich`'s ALPHABETIC baseline
 *  (`drawRich` always draws on alphabetic — see its doc). Shared here so
 *  every caller that owns a top/bottom-baseline anchor (uPlot's own axis-
 *  label pass in uplotRichLabels.ts; the annotation draw pass in
 *  uplotOverlays.ts, which draws with `textBaseline: "bottom"`) converts
 *  with the SAME numbers rather than redefining them per caller: bottom ->
 *  alphabetic subtracts the descent (`y - DESCENT_EM * px`), top ->
 *  alphabetic adds the ascent (`y + ASCENT_EM * px`). */
export const ASCENT_EM = 0.78;
export const DESCENT_EM = 0.22;

// Fraction layout (em of the fraction's own level).
const FRAC_AXIS_EM = 0.28; // rule height above the baseline (the math axis)
const FRAC_GAP_EM = 0.16; // clearance between num/den and the rule
const FRAC_PAD_EM = 0.14; // horizontal inset + rule overhang past the content
// Radical layout.
const SQRT_LEAD_EM = 0.55; // radical-sign width before the radicand
const SQRT_GAP_EM = 0.14; // clearance between the overline and the radicand top
const SQRT_TAIL_EM = 0.12; // overline overhang past the radicand
const INDEX_SCALE = 0.55; // \sqrt[n] root-index size
// Large-operator layout.
const BIGOP_SCALE = 1.4; // \sum/\int/\prod glyph size vs the surrounding text
const LIMIT_SCALE = 0.6; // stacked \sum/\prod limit size
const BIGOP_GAP_EM = 0.1; // clearance between the operator and its stacked limits
// Rule/stroke thickness (em), floored so it never vanishes at small sizes.
const RULE_EM = 0.055;

/** A laid-out node's extent, relative to its alphabetic baseline. */
export interface RichBox {
  width: number;
  ascent: number; // ink extent ABOVE the baseline (>= 0)
  descent: number; // ink extent BELOW the baseline (>= 0)
}

function fontString(px: number, italic: boolean, weight: string | undefined, family: string): string {
  return `${italic ? "italic " : ""}${weight ? `${weight} ` : ""}${px}px ${family}`;
}

/** Lay out a node list left-to-right at baseline `y`; draws each node when
 *  `draw`. Returns the aggregate box (width = total advance). `px` is the
 *  current level's size. Mutates ctx.font (and, when drawing rules, path
 *  state). */
function layout(
  ctx: RichTextCtx,
  nodes: RichNode[],
  font: RichFont,
  px: number,
  x: number,
  y: number,
  draw: boolean,
): RichBox {
  let cx = x;
  let ascent = 0;
  let descent = 0;
  for (const n of nodes) {
    const b = layoutNode(ctx, n, font, px, cx, y, draw);
    cx += b.width;
    ascent = Math.max(ascent, b.ascent);
    descent = Math.max(descent, b.descent);
  }
  return { width: cx - x, ascent, descent };
}

function layoutNode(
  ctx: RichTextCtx,
  n: RichNode,
  font: RichFont,
  px: number,
  x: number,
  y: number,
  draw: boolean,
): RichBox {
  switch (n.kind) {
    case "text": {
      ctx.font = fontString(px, n.italic, font.weight, font.family);
      if (draw) ctx.fillText(n.text, x, y);
      return { width: ctx.measureText(n.text).width, ascent: ASCENT_EM * px, descent: DESCENT_EM * px };
    }
    case "sup":
    case "sub": {
      const shift = (n.kind === "sup" ? -1 : 1) * SCRIPT_SHIFT_EM * px;
      const cb = layout(ctx, n.children, font, px * SCRIPT_SCALE, x, y + shift, draw);
      return {
        width: cb.width,
        // shift is negative for sup (moves ink up -> more ascent, less descent).
        ascent: Math.max(0, cb.ascent - shift),
        descent: Math.max(0, cb.descent + shift),
      };
    }
    case "frac":
      return layoutFrac(ctx, n, font, px, x, y, draw);
    case "sqrt":
      return layoutSqrt(ctx, n, font, px, x, y, draw);
    case "bigop":
      return layoutBigop(ctx, n, font, px, x, y, draw);
  }
}

function layoutBigop(
  ctx: RichTextCtx,
  n: Extract<RichNode, { kind: "bigop" }>,
  font: RichFont,
  px: number,
  x: number,
  y: number,
  draw: boolean,
): RichBox {
  const opPx = px * BIGOP_SCALE;
  ctx.font = fontString(opPx, false, font.weight, font.family);
  const opW = ctx.measureText(n.op).width;
  const opAsc = ASCENT_EM * opPx;
  const opDesc = DESCENT_EM * opPx;
  const axis = FRAC_AXIS_EM * px;
  // Straddle the math axis (center the glyph on y - axis) like matplotlib.
  const yg = y - axis + (opAsc - opDesc) / 2;
  const opTop = yg - opAsc;
  const opBottom = yg + opDesc;
  const limitPx = px * LIMIT_SCALE;
  const gap = BIGOP_GAP_EM * px;
  const overB = n.over ? layout(ctx, n.over, font, limitPx, 0, 0, false) : null;
  const underB = n.under ? layout(ctx, n.under, font, limitPx, 0, 0, false) : null;
  const contentW = Math.max(opW, overB?.width ?? 0, underB?.width ?? 0);
  const overBaseline = overB ? opTop - gap - overB.descent : 0;
  const underBaseline = underB ? opBottom + gap + underB.ascent : 0;
  if (draw) {
    ctx.font = fontString(opPx, false, font.weight, font.family);
    ctx.fillText(n.op, x + (contentW - opW) / 2, yg);
    if (n.over && overB) {
      layout(ctx, n.over, font, limitPx, x + (contentW - overB.width) / 2, overBaseline, true);
    }
    if (n.under && underB) {
      layout(ctx, n.under, font, limitPx, x + (contentW - underB.width) / 2, underBaseline, true);
    }
  }
  const top = overB ? Math.min(opTop, overBaseline - overB.ascent) : opTop;
  const bottom = underB ? Math.max(opBottom, underBaseline + underB.descent) : opBottom;
  return { width: contentW, ascent: y - top, descent: bottom - y };
}

function layoutFrac(
  ctx: RichTextCtx,
  n: Extract<RichNode, { kind: "frac" }>,
  font: RichFont,
  px: number,
  x: number,
  y: number,
  draw: boolean,
): RichBox {
  const numB = layout(ctx, n.num, font, px, 0, 0, false);
  const denB = layout(ctx, n.den, font, px, 0, 0, false);
  const axis = FRAC_AXIS_EM * px;
  const gap = FRAC_GAP_EM * px;
  const pad = FRAC_PAD_EM * px;
  const rule = Math.max(1, RULE_EM * px);
  const contentW = Math.max(numB.width, denB.width);
  const width = contentW + 2 * pad;
  const barY = y - axis;
  if (draw) {
    ctx.lineWidth = rule;
    ctx.beginPath();
    ctx.moveTo(x + pad * 0.4, barY);
    ctx.lineTo(x + width - pad * 0.4, barY);
    ctx.stroke();
    // numerator sits above the rule, denominator below, both centered.
    layout(ctx, n.num, font, px, x + pad + (contentW - numB.width) / 2, barY - gap - numB.descent, true);
    layout(ctx, n.den, font, px, x + pad + (contentW - denB.width) / 2, barY + gap + denB.ascent, true);
  }
  return {
    width,
    ascent: axis + gap + numB.descent + numB.ascent,
    descent: -axis + gap + denB.ascent + denB.descent,
  };
}

function layoutSqrt(
  ctx: RichTextCtx,
  n: Extract<RichNode, { kind: "sqrt" }>,
  font: RichFont,
  px: number,
  x: number,
  y: number,
  draw: boolean,
): RichBox {
  const radB = layout(ctx, n.radicand, font, px, 0, 0, false);
  const lead = SQRT_LEAD_EM * px;
  const gap = SQRT_GAP_EM * px;
  const tail = SQRT_TAIL_EM * px;
  const rule = Math.max(1, RULE_EM * px);
  const indexPx = px * INDEX_SCALE;
  const indexB = n.index ? layout(ctx, n.index, font, indexPx, 0, 0, false) : null;
  const radTop = y - radB.ascent - gap; // the overline height
  const radBottom = y + radB.descent;
  const width = lead + radB.width + tail;
  // index baseline: sits just above the overline start, tucked in the crook.
  const indexBaseline = radTop + (indexB ? indexB.descent : 0);
  if (draw) {
    ctx.lineWidth = rule;
    ctx.beginPath();
    ctx.moveTo(x + lead * 0.06, y - radB.ascent * 0.28); // start partway up the left
    ctx.lineTo(x + lead * 0.36, radBottom); // down to the bottom point
    ctx.lineTo(x + lead * 0.62, radTop); // tall stroke up to the overline
    ctx.lineTo(x + width - tail * 0.4, radTop); // overline across the radicand
    ctx.stroke();
    layout(ctx, n.radicand, font, px, x + lead, y, true);
    if (n.index) layout(ctx, n.index, font, indexPx, x + lead * 0.08, indexBaseline, true);
  }
  const overlineAscent = radB.ascent + gap + rule;
  const indexAscent = indexB ? y - (indexBaseline - indexB.ascent) : 0;
  return { width, ascent: Math.max(overlineAscent, indexAscent), descent: radB.descent };
}

/** Full vertical box (advance width + ascent + descent) of the AST at `font`.
 *  No drawing (mutates ctx.font — wrap in save/restore if state matters). */
export function measureRichBox(ctx: RichTextCtx, nodes: RichNode[], font: RichFont): RichBox {
  return layout(ctx, nodes, font, font.px, 0, 0, false);
}

/** Total advance width of the AST at `font` (no drawing; mutates ctx.font —
 *  wrap in save/restore if the surrounding state matters). */
export function measureRich(ctx: RichTextCtx, nodes: RichNode[], font: RichFont): number {
  return measureRichBox(ctx, nodes, font).width;
}

/** Draw the AST with its root ALPHABETIC baseline at `y`. `align: "center"`
 *  centers the total advance on `x` (left-aligned otherwise). Returns the
 *  total advance width. Caller save/restores ctx (font/fill/stroke/align
 *  mutate). */
export function drawRich(
  ctx: RichTextCtx,
  nodes: RichNode[],
  x: number,
  y: number,
  font: RichFont,
  color: string,
  align: "left" | "center" = "left",
): number {
  const width = measureRich(ctx, nodes, font);
  const startX = align === "center" ? x - width / 2 : x;
  ctx.fillStyle = color;
  ctx.strokeStyle = color; // fraction rule / radical share the ink color
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  layout(ctx, nodes, font, font.px, startX, y, true);
  return width;
}
