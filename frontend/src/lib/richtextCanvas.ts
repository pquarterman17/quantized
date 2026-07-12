// Rich-text canvas renderer (GOTO #5): measure + draw a `richtext` AST on a
// CanvasRenderingContext2D. Sub/superscripts render at 0.7x the current size
// with a ±0.35 em baseline shift (em of the CURRENT level, so nested scripts
// scale and shift multiplicatively); italics via the CSS font-style slot;
// Greek / Å / ° are plain Unicode codepoints (the parser already substituted
// them). Rotation (the y-axis label) is the CALLER's job: rotate the ctx and
// draw at the transformed origin — see uplotRichLabels.
//
// WYSIWYG note (honest limits vs matplotlib mathtext): mathtext positions
// scripts with real font metrics and italic-corrected kerning; this renderer
// uses fixed 0.7x / ±0.35 em conventions, so glyph-level spacing differs by
// ~a px at typical label sizes while reading identically. A `x^2_3` base
// gets its scripts drawn SEQUENTIALLY (sup then sub, advancing right), not
// stacked in one column as TeX does.

import type { RichNode } from "./richtext";

/** Base font for a rich-text run (CSS pixel size; family list as in CSS). */
export interface RichFont {
  px: number;
  family: string;
  /** CSS font-weight slot (e.g. "600"); omitted = normal. */
  weight?: string;
}

/** The ctx subset used — lets tests pass a lightweight mock. */
export type RichTextCtx = Pick<
  CanvasRenderingContext2D,
  "font" | "fillStyle" | "textAlign" | "textBaseline" | "fillText" | "measureText"
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

function fontString(px: number, italic: boolean, weight: string | undefined, family: string): string {
  return `${italic ? "italic " : ""}${weight ? `${weight} ` : ""}${px}px ${family}`;
}

/** Walk the AST left-to-right; measures always, draws when `draw`. Returns
 *  the advance (end x). `px` is the current level's size; `dy` its baseline
 *  offset from the root alphabetic baseline `y`. Mutates ctx.font. */
function walk(
  ctx: RichTextCtx,
  nodes: RichNode[],
  font: RichFont,
  px: number,
  dy: number,
  x: number,
  y: number,
  draw: boolean,
): number {
  let cx = x;
  for (const n of nodes) {
    if (n.kind === "text") {
      ctx.font = fontString(px, n.italic, font.weight, font.family);
      if (draw) ctx.fillText(n.text, cx, y + dy);
      cx += ctx.measureText(n.text).width;
    } else {
      const shift = (n.kind === "sup" ? -1 : 1) * SCRIPT_SHIFT_EM * px;
      cx = walk(ctx, n.children, font, px * SCRIPT_SCALE, dy + shift, cx, y, draw);
    }
  }
  return cx;
}

/** Total advance width of the AST at `font` (no drawing; mutates ctx.font —
 *  wrap in save/restore if the surrounding state matters). */
export function measureRich(ctx: RichTextCtx, nodes: RichNode[], font: RichFont): number {
  return walk(ctx, nodes, font, font.px, 0, 0, 0, false);
}

/** Draw the AST with its root ALPHABETIC baseline at `y`. `align: "center"`
 *  centers the total advance on `x` (left-aligned otherwise). Returns the
 *  total advance width. Caller save/restores ctx (font/fill/align mutate). */
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
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  walk(ctx, nodes, font, font.px, 0, startX, y, true);
  return width;
}
