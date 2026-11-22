// Passive uPlot draw-overlays: decorations rendered from persistent app state
// (reference lines, annotations, the publication axis-box frame, error bars).
// Pixels are re-derived from data coords on every draw, so overlays stay pinned
// across zoom/pan. refLinePlugin is optionally interactive (drag to move a line);
// the rest are pure draw hooks. The active drag-gesture tools live in uplotTools.
import type uPlot from "uplot";
import type { ErrorSpan } from "./errorbars";
import {
  canvasToOverCss,
} from "./annotationHit";
import type { ColorScatterSpec } from "./colorscatter";
import { richLabelAst, type RichNode } from "./richtext";
import { measureRich, type RichFont } from "./richtextCanvas";
import type { Annotation } from "./types";
import type { RegionShade } from "./types";
// Shade drawing + the off-scale marker are a lazy chunk (lib/regionDecorLoader.ts).
import { regionDecor } from "./regionDecorLoader";
export { pickRefLine, type RefLineHit } from "./refLineHit";

/** Draw a full rectangular frame around the plot area (the "axis box" look that
 *  publications favour, esp. with the grid off). uPlot's per-axis border only
 *  gives an L; this strokes all four sides of u.bbox. (#17) */
export function axisBoxPlugin(color: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([]); // a dashed series leaves its dash on the shared context
        ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
        ctx.restore();
      },
    },
  };
}

/** The leading `<n>px` in a CSS font shorthand (uplotOpts always builds one,
 *  e.g. `"11px monospace"`), or 11 when it can't be parsed — used to estimate
 *  a label's line height for the vertical clamp below (no canvas access
 *  needed, so it stays plain math). Exported for the pointer-mode edit
 *  plugin's own line-height math (annotationLayout below). */
export function fontPx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? parseFloat(m[1]) : 11;
}

/** The family list after the leading `<n>px` in a CSS font shorthand — the
 *  counterpart to `fontPx` above. Used to build a `RichFont` (px + family)
 *  for the shared rich-text canvas renderer (richtextCanvas.ts) without
 *  widening `annotationPlugin`'s plain-CSS-string `font` parameter — MAIN
 *  #25 reuses the GOTO #5 renderer for annotation text exactly as-is. */
export function fontFamily(font: string): string {
  const m = /\d+(?:\.\d+)?px\s+(.+)$/.exec(font);
  return m ? m[1] : font;
}

/** MAIN #18's corner-handle resize clamp — shared by the plugin's live
 *  preview, the store's `updateAnnotation` commit, and the object menu's
 *  Size +/− entries, so the same [6, 72] px range applies everywhere a
 *  size can be set. */
export const MIN_ANNOTATION_SIZE = 6;
export const MAX_ANNOTATION_SIZE = 72;

export function clampAnnotationSize(v: number): number {
  return Math.min(MAX_ANNOTATION_SIZE, Math.max(MIN_ANNOTATION_SIZE, Math.round(v)));
}

/** Per-annotation font override: `a.size` (px) replaces the base font's
 *  leading `<n>px`, keeping the family — absent/zero returns `baseFont`
 *  unchanged (today's behaviour for every annotation with no `size`). */
export function annotationFont(baseFont: string, size?: number): string {
  if (!size) return baseFont;
  return baseFont.replace(/\d+(?:\.\d+)?px/, `${size}px`);
}

/** The RichFont (px + family) for one annotation's font override — the SAME
 *  px `annotationFont` resolves (baseFont's leading `<n>px`, or `a.size`
 *  when set) paired with the plain-text family from `baseFont`. Both the
 *  hit-test width measurement (`annotationLayout`) and the rich draw pass
 *  build their font from this ONE function, so a resized rich annotation's
 *  hit box always matches what's actually drawn (MAIN #25). */
export function annotationRichFont(baseFont: string, size?: number): RichFont {
  return { px: fontPx(annotationFont(baseFont, size)), family: fontFamily(baseFont) };
}

/** Clamp a fraction to [0, 1] — the shared clamp every page-anchor helper
 *  below uses (same convention as `plotview.ts`'s `legendXYOrNull`). */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** PAGE-anchor conversion (MAIN #21): a CANVAS pixel -> the fraction
 *  `Annotation.anchor:"page"` stores, clamped into [0, 1] so an off-canvas
 *  or margin-placed dot still converts to a valid page position. Degenerate
 *  (zero/negative) canvas dims return `{0, 0}` rather than dividing by zero.
 *  Pure — the exact inverse of `pageXYToCanvasPx` below (see
 *  `uplotOverlays.test.ts`'s round-trip test), which is what makes the
 *  data<->page toggle (`annotationAnchorConversions`) safe to compute
 *  without a live canvas. */
export function canvasPxToPageXY(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  if (canvasW <= 0 || canvasH <= 0) return { x: 0, y: 0 };
  return { x: clamp01(px / canvasW), y: clamp01(py / canvasH) };
}

/** The inverse of `canvasPxToPageXY`: a page fraction -> its CANVAS pixel —
 *  `annotationLayout`'s page branch and the toggle conversion both use this
 *  same one implementation so draw and hit-test never disagree (the same
 *  "one geometry source" discipline this file's header describes). */
export function pageXYToCanvasPx(
  page: { x: number; y: number },
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  return { x: page.x * canvasW, y: page.y * canvasH };
}

/** Clamp a page-anchor fraction so its CANVAS pixel stays `pad` px inside the
 *  canvas edges — the page-anchor analogue of the interactive plugin's
 *  `clampToCanvas` (data-anchor pad), expressed directly in fraction space so
 *  it needs no live uPlot instance. Degenerate (zero/negative) canvas dims
 *  skip the clamp (return the fraction unchanged) rather than dividing by
 *  zero — matching `canvasPxToPageXY`'s same-case fallback. */
export function clampPageXY(
  x: number,
  y: number,
  canvasW: number,
  canvasH: number,
  pad = 6,
): { x: number; y: number } {
  if (canvasW <= 0 || canvasH <= 0) return { x, y };
  const loX = pad / canvasW;
  const hiX = 1 - loX;
  const loY = pad / canvasH;
  const hiY = 1 - loY;
  return { x: Math.min(hiX, Math.max(loX, x)), y: Math.min(hiY, Math.max(loY, y)) };
}

/** Clamp a DATA-space (x, y) so the CANVAS pixel it resolves to stays `pad`
 *  px inside the canvas edges — the data-anchor analogue of `clampPageXY`
 *  above (which clamps PAGE fractions). Bug-hunt Bug 3: an unclamped
 *  data-anchor drag could commit off-canvas coords that become unreachable
 *  by a later click — only the Inspector's Shapes/Annotations-card delete
 *  could recover it. Originally a private closure inside annotationPlugin's
 *  `ready` hook (the dragged-dot commit); lifted to a shared top-level
 *  export so `uplotShapes.ts`'s data-anchor shape body-move AND
 *  handle-reshape drags reuse the SAME ONE clamp rather than reimplementing
 *  it. Degenerate (zero/negative) canvas dims skip the clamp (return x/y
 *  unchanged), matching `clampPageXY`'s same-case fallback. */
export function clampToCanvas(
  u: Pick<uPlot, "valToPos" | "posToVal" | "ctx" | "root" | "over">,
  x: number,
  y: number,
  pad = 6,
): { x: number; y: number } {
  const cw = u.ctx.canvas?.width ?? 0;
  const chh = u.ctx.canvas?.height ?? 0;
  if (cw <= 0 || chh <= 0) return { x, y };
  const rootRect = u.root.getBoundingClientRect();
  const overRect = u.over.getBoundingClientRect();
  const s = rootRect.width > 0 ? cw / rootRect.width : 1;
  const px = Math.min(Math.max(u.valToPos(x, "x", true), pad), cw - pad);
  const py = Math.min(Math.max(u.valToPos(y, "y", true), pad), chh - pad);
  const cssX = px / s - (overRect.left - rootRect.left);
  const cssY = py / s - (overRect.top - rootRect.top);
  return { x: u.posToVal(cssX, "x"), y: u.posToVal(cssY, "y") };
}

/** One annotation's on-canvas geometry — the SINGLE geometry implementation
 *  shared by the plain draw pass and the pointer-mode hit-test/selection
 *  outline (see `annotationHit.ts`'s header for why that matters). `tx`/`ty`
 *  are the exact `fillText` anchor point/baseline; `align` is the
 *  `ctx.textAlign` it was computed for. Null for a non-finite (x, y)
 *  annotation (skip, same as the draw loop always did). Mutates
 *  `u.ctx.font` (needed for `measureText`) — callers that also draw must
 *  re-read/re-set it afterward if they relied on a specific prior value. */
export interface AnnotationLayout {
  px: number;
  py: number;
  tx: number;
  ty: number;
  textWidth: number;
  align: "left" | "right";
  lineHeight: number;
  /** Parsed rich-text AST when `a.text` is valid `$...$` markup (GOTO #5
   *  syntax reused for annotations, MAIN #25); null for plain text OR
   *  invalid markup — the literal-fallback contract, same as titles/axis
   *  labels. `textWidth` above is ALWAYS measured against this same parse
   *  (via `measureRich` when rich, `ctx.measureText` when not), so the hit
   *  box and the draw pass can never disagree about what's "rich" or how
   *  wide it renders — raw `$...$` markup is longer than its rendered
   *  glyphs, so measuring the raw string would overhang the hit box. */
  rich: RichNode[] | null;
}
export function annotationLayout(
  u: Pick<uPlot, "valToPos" | "ctx" | "bbox" | "scales">,
  a: Annotation,
  baseFont: string,
): AnnotationLayout | null {
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
  // Label clamping bounds are the whole CANVAS, not the axes bbox: a dragged
  // annotation may legitimately live in the margins (Origin's model — owner
  // report 2026-07-11: dragging the "700 mT" label outside the axes box made
  // it vanish). Fall back to the bbox for stub contexts without a canvas —
  // also the PAGE anchor's own frame (MAIN #21: x/y are canvas fractions),
  // so it's computed unconditionally, not just inside the label-clamp step.
  const canvasW = u.ctx.canvas?.width ?? u.bbox.left + u.bbox.width;
  const canvasH = u.ctx.canvas?.height ?? u.bbox.top + u.bbox.height;
  // PAGE anchor (MAIN #21, Origin's page-text model): x/y are canvas
  // fractions, resize-stable — same one conversion `pageXYToCanvasPx` the
  // toggle-conversion helper below inverts, so draw/hit-test/toggle can
  // never disagree. DATA anchor (absent/"data", back-compat): x/y run
  // through valToPos exactly as before this field existed.
  const hasY2 = u.scales.y2 != null;
  const yScale = a.axis === 1 && hasY2 ? "y2" : "y";
  const { x: px, y: py } =
    a.anchor === "page"
      ? pageXYToCanvasPx({ x: a.x, y: a.y }, canvasW, canvasH)
      : { x: u.valToPos(a.x, "x", true), y: u.valToPos(a.y, yScale, true) };
  const font = annotationFont(baseFont, a.size);
  u.ctx.font = font;
  // MAIN #25: `a.text` gets the SAME `$...$` micro-syntax as titles/axis
  // labels (GOTO #5) — richLabelAst is the one gate (hasMarkup fast-path +
  // parse + validate) every rich surface uses, so invalid markup falls back
  // to null (plain-text measurement/draw) exactly like the canvas/DOM/export
  // renderers already do.
  const rich = a.text ? richLabelAst(a.text) : null;
  const textWidth = !a.text
    ? 0
    : rich
      ? measureRich(u.ctx, rich, annotationRichFont(baseFont, a.size))
      : u.ctx.measureText(a.text).width;
  const { x: tx, align } = clampAnnotationLabelX(px, textWidth, 6, 0, canvasW);
  const lineHeight = fontPx(font) * 1.3;
  const ty = Math.max(py - 2, lineHeight);
  return { px, py, tx, ty, textWidth, align, lineHeight, rich };
}

/** The label's bounding box (canvas pixels), derived from its layout — used
 *  for the pointer-mode rect hit-test and the selection outline. Zero
 *  width/height for an empty-text annotation (the dot-only case). */
export function annotationBox(l: AnnotationLayout): { left: number; top: number; width: number; height: number } {
  return {
    left: l.align === "left" ? l.tx : l.tx - l.textWidth,
    top: l.ty - l.lineHeight,
    width: l.textWidth,
    height: l.lineHeight,
  };
}

/** Where to draw one annotation's label text and which side to anchor it
 *  from, given the dot's already-clipped pixel x (`px`), the label's
 *  measured pixel width, the intended offset from the dot, and the plot
 *  area's horizontal bounds `[left, left + width]`.
 *
 *  Left-anchors at `px + offset` (the label sitting to the right of its dot,
 *  the normal case) unless that would run the label past the panel's right
 *  edge, in which case it flips to a right-anchor at `px - offset` (mirrored
 *  to the LEFT of the dot) — and if even that overflows the opposite edge
 *  (a label wider than the whole panel, or a dot pinned hard against one
 *  side), clamps the left-anchor position inward so the label's start stays
 *  on-panel rather than bleeding off it entirely.
 *
 *  Pure math, no canvas access — unit-testable without a 2D-context stub.
 *  Every mark drawn near a panel's left edge (any single-book figure's
 *  bottom-left-corner label, or every sub-panel of a multi-panel spread —
 *  each its own separately-canvased uPlot instance, so text spilling past
 *  ITS OWN left edge is simply invisible, not merely close to another
 *  panel's content) needs this: see `annotationPlugin`'s docstring for the
 *  root cause this replaces (an inherited `textAlign` that put the label
 *  BEHIND the dot instead of after it). */
export function clampAnnotationLabelX(
  px: number,
  textWidth: number,
  offset: number,
  left: number,
  width: number,
): { x: number; align: "left" | "right" } {
  const right = left + width;
  if (px + offset + textWidth <= right) return { x: px + offset, align: "left" };
  if (px - offset - textWidth >= left) return { x: px - offset, align: "right" };
  return { x: Math.max(left, Math.min(px + offset, right - textWidth)), align: "left" };
}

/** Draw text annotations (a small dot + label) pinned at data coordinates,
 *  clipped to the plot area so off-screen labels don't bleed into the axes.
 *  A mark tagged `axis: 1` (an Origin double-Y apply's upper-layer marks —
 *  see `originFigureAnnotations`) plots against the SECONDARY (y2) scale
 *  instead of the primary one, but only when this plot actually has a y2
 *  scale — a y2-tagged mark surviving onto a single-axis plot (e.g. after
 *  y2Keys was cleared) falls back to the primary scale rather than reading
 *  `u.scales.y2` as undefined.
 *
 *  `ctx.textAlign` is set explicitly on every draw (never left implicit):
 *  uPlot's own axis-label pass (`setFontStyle` in uPlot.esm.js) writes
 *  `textAlign`/`textBaseline` straight onto the shared canvas context with no
 *  save/restore, and never resets them before firing "draw" hooks — so
 *  whichever axis it drew LAST (typically the left Y-axis, which right-
 *  aligns its tick labels) leaves `textAlign: "right"` resident. An unset
 *  `textAlign` here silently inherited that, so `fillText(text, px + 6, …)`
 *  anchored the label's RIGHT edge at `px + 6` instead of its left — the
 *  label was drawn BEHIND its dot (extending leftward), not after it. For any
 *  mark sitting near a panel's left edge (Origin authors habitually pin these
 *  little curve labels bottom-left, and a multi-panel spread's per-layer
 *  marks are typically that same near-the-axis position in every panel) the
 *  label then ran into the y-axis title/tick-label gutter in a single plot,
 *  or clean off the edge of its own (separately canvased) panel in a
 *  multi-panel spread — invisible, not merely crowded. Confirmed against the
 *  live-COM oracle render of PNR.opj's `1p5mT`/`700mT` figures (Book15/
 *  Book14): the decoded mark position already matches where Origin itself
 *  puts the label (bottom-left, deliberately overlapping its own tick-label
 *  row) — the position was never wrong, only which direction the text grew
 *  from it.
 *
 *  MAIN #18 (pointer tool direct manipulation): `opts.interactive` composes
 *  select/drag-move/corner-handle-resize/double-click-edit/right-click-menu
 *  INTO this same plugin, rather than a second plugin that also draws — the
 *  drawing and the dragging must share ONE live-override, or the dragged
 *  annotation's dot+label (drawn here) and its selection outline (also drawn
 *  here) would read from two different positions mid-gesture. Same
 *  capture-phase-mousedown-beats-box-zoom + commit-once-on-release pattern as
 *  `refLinePlugin` above and `uplotAnchors.ts`'s anchorEditPlugin (read that
 *  file's header for the full reasoning) — the difference from refLinePlugin
 *  is annotations need BOTH a point hit-test (the dot) and a rect hit-test
 *  (the label extents), so the actual hit-testing lives in `annotationHit.ts`. */
export interface AnnotationEditOpts {
  /** Non-null id draws a selection outline + resize handle for that ONE
   *  annotation. */
  selectedId?: string | null;
  /** Wires the mouse handlers below; false/absent keeps this plugin exactly
   *  as before (every non-pointer tool — plain draw, no listeners). */
  interactive?: boolean;
  /** Selection outline + resize-handle colour — the design-token accent, not
   *  the plain annotation ink colour, so a selected object visibly stands
   *  out (defaults to `color` when omitted). */
  selectColor?: string;
  /** A text box's default fill: the plot background token (`axesBg`). */
  paperColor?: string;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, size: number) => void;
  onEditText?: (id: string) => void;
  /** `conv` (MAIN #21) is the hit annotation's data<->page anchor conversion,
   *  precomputed at menu-open time from its CURRENT on-canvas position (see
   *  `annotationAnchorConversions`) — the menu builder (React side) has no
   *  live uPlot instance of its own, so it can't compute this itself. Staled
   *  by any pan/zoom, but the menu already closes on scroll/zoom, so that's
   *  never observable. */
  onContextMenu?: (
    id: string,
    clientX: number,
    clientY: number,
    conv: { toPage: { x: number; y: number }; toData: { x: number; y: number } },
  ) => void;
  /** Double-click on EMPTY canvas — reset the zoom through the store (clears
   *  committed axis limits, which uPlot's internal dblclick-autoscale can't). */
  onResetView?: () => void;
}

/** The data<->page anchor conversion for ONE annotation (MAIN #21), computed
 *  from its CURRENT on-canvas position regardless of its CURRENT anchor —
 *  `toPage` is what its coords would become on a data->page toggle (canvas
 *  px divided by canvas dims, `canvasPxToPageXY`); `toData` is the reverse
 *  (canvas px -> CSS px relative to `over` via `canvasToOverCss` ->
 *  `u.posToVal`, on the SAME y scale (`y`/`y2`) `annotationLayout` resolved
 *  `a.axis` against). The object-menu toggle (`useAnnotationEdit.openMenu`)
 *  picks whichever of the two matches the requested direction, so the
 *  label's on-screen position never jumps when the anchor flips. Exported
 *  for its own round-trip unit test (data -> page -> data lands back at the
 *  original coords within float tolerance). */
export function annotationAnchorConversions(
  u: Pick<uPlot, "ctx" | "posToVal" | "scales" | "root" | "over">,
  a: Annotation,
  layout: Pick<AnnotationLayout, "px" | "py">,
): { toPage: { x: number; y: number }; toData: { x: number; y: number } } {
  const canvasW = u.ctx.canvas?.width ?? 0;
  const canvasH = u.ctx.canvas?.height ?? 0;
  const toPage = canvasPxToPageXY(layout.px, layout.py, canvasW, canvasH);
  const rootRect = u.root.getBoundingClientRect();
  const overRect = u.over.getBoundingClientRect();
  const overCss = canvasToOverCss({ x: layout.px, y: layout.py }, { width: canvasW, height: canvasH }, rootRect, overRect);
  const hasY2 = u.scales.y2 != null;
  const yScale = a.axis === 1 && hasY2 ? "y2" : "y";
  // Upright only: annotation drag editing (the one caller) is switched off on a turned plot (uplotOrient.orientArgs), so x is the horizontal position here.
  const toData = { x: u.posToVal(overCss.x, "x"), y: u.posToVal(overCss.y, yScale) };
  return { toPage, toData };
}

/** Default frame padding (CSS px, every side) when `frame.pad` is absent —
 *  MAIN #27's "text box". */
export const DEFAULT_FRAME_PAD = 4;

export function resolveFrameOpacity(frame: NonNullable<Annotation["frame"]>): number {
  return frame.opacity ?? 1;
}
export function resolveFrameStroke(frame: NonNullable<Annotation["frame"]>, inkColor: string): string {
  return frame.stroke ?? inkColor;
}
/** Default fill = the plot's own PAPER (axes background token), behind ink
 *  text and an ink border — the export's white card with a black border on
 *  every theme. It used to default to the stroke (= the ink), so a dark
 *  canvas drew light text on a near-white box (audit #11). */
export function resolveFrameFill(frame: NonNullable<Annotation["frame"]>, paperColor: string): string {
  return frame.fill ?? paperColor;
}

/** Draw vertical error-bar whiskers (y ± e) for selected data columns, with
 *  optional end caps. `errorsByCol` is keyed by uPlot data-column index
 *  (1-based); each value is the per-point error magnitude (null = no bar
 *  there). Each column's whiskers use that series' own y scale (primary or
 *  secondary). Clipped to the plot area so off-range whiskers don't bleed
 *  into the axes.
 *
 *  `capHalfWidth` (CSS px) defaults to 0 — bars only. The interactive plot
 *  passes `uplotErrorRange.ERROR_CAP_HALF_PX` to match the export's caps. */
/** The fixed render alpha for Origin region shades: Origin's own
 *  fill-transparency field is UNDECODED (decode-plan #41 — no byte could be
 *  isolated across the corpus, see docs/origin_project_format.md §6.1), so
 *  this is a documented presentation choice — pale enough that data drawn
 *  over the band stays readable, matching Origin's pastel render. Mirrored
 *  exactly by calc/figure_decor.py's REGION_SHADE_ALPHA. */
export const REGION_SHADE_ALPHA = 0.25;

/** Draw filled region rectangles (Origin `Rect*` bands — e.g. film-stack
 *  shading on an SLD profile, decode-plan #41) BEHIND the grid and data:
 *  the `drawClear` hook fires right after the canvas clears, before
 *  axes/grid/series paint over it — matching Origin, which draws these
 *  under everything. Extents are data coords re-derived on every draw
 *  (pinned across zoom/pan) and clipped to the plot area; a shade tagged
 *  `axis: 1` maps its y-extent through the y2 scale when the plot has one
 *  (same fallback rule as annotationPlugin). A `fullHeight` shade spans the
 *  plot height whatever the y scale (see this module's header). */
export function regionShadePlugin(shades: RegionShade[]): uPlot.Plugin {
  return { hooks: { drawClear: (u: uPlot) => regionDecor()?.drawRegionShades(u, shades) } };
}

export function errorBarsPlugin(
  errorsByCol: Map<number, (number | null)[]>,
  color: string,
  capHalfWidth = 0,
): uPlot.Plugin {
  return {
    hooks: {
      // The drawing is the startup chunk's (lib/uplotErrorDraw.ts); gap audit 4 G8's
      // band column is shaded under the lines (drawAxes), not barred.
      drawAxes: (u: uPlot) => regionDecor()?.drawErrorBands(u, errorsByCol, color),
      draw: (u: uPlot) => regionDecor()?.drawErrorBars(u, errorsByCol, color, capHalfWidth),
    },
  };
}


/** Draw colour-mapped scatter points (MAIN #14) for every series in `specs`
 *  (keyed by uPlot data-column index, 1-based — see `colorscatter.buildColorByColumns`):
 *  each point's fill colour comes from sampling that series' colormap at its
 *  own row's z value, normalized over the channel's full [lo, hi] range. The
 *  series' NATIVE line/points are hidden by the caller (`buildOpts`, which
 *  forces `width: 0, points: {show: false}` for any series with a colorBy
 *  entry) — this plugin is the ONLY thing that draws those points, the same
 *  "hide native, draw an overlay keyed to displayed x/y" pattern
 *  `errorBarsPlugin`/`annotationPlugin` use above. `z` may be longer than the
 *  plotted x (same convention as `errorBarsPlugin`'s `errsByCol` — extra tail
 *  entries are simply unused); a null/non-finite z at a row draws no point. */
export function colorScatterPlugin(specs: Map<number, ColorScatterSpec>): uPlot.Plugin {
  return {
    hooks: {
      // The drawing is the startup chunk's (lib/uplotScatterDraw.ts, eager-budget move).
      draw: (u: uPlot) => regionDecor()?.drawColorScatter(u, specs),
    },
  };
}

/** Draw asymmetric and/or X error bars (MAIN_PLAN #36).
 *
 *  The sibling `errorBarsPlugin` draws one symmetric VERTICAL magnitude, which
 *  is all the legacy `errKeys` shape could express. This one honours what the
 *  instrument actually supplied: independent up/down magnitudes, and horizontal
 *  whiskers for x uncertainty.
 *
 *  Off-scale ends are left to the canvas clip rather than pre-filtered — a bar
 *  whose far end sits outside the view should still be drawn TO the edge, since
 *  dropping it entirely would understate the uncertainty exactly where the
 *  reader is most likely to misread it. Log axes need no special case for the
 *  same reason `valToPos` already handles them: a non-positive endpoint maps to
 *  NaN and the browser skips that segment.
 */
export function errorSpansPlugin(
  spansByCol: Map<number, ErrorSpan[]>,
  color: string,
  capHalfWidth = 0,
): uPlot.Plugin {
  return {
    hooks: {
      // As errorBarsPlugin: lib/uplotErrorDraw.ts draws; a band's X spans stay bars.
      drawAxes: (u: uPlot) => regionDecor()?.drawErrorBands(u, spansByCol, color),
      draw: (u: uPlot) => regionDecor()?.drawErrorSpans(u, spansByCol, color, capHalfWidth),
    },
  };
}
