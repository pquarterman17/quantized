// Passive uPlot draw-overlays: decorations rendered from persistent app state
// (reference lines, annotations, the publication axis-box frame, error bars).
// Pixels are re-derived from data coords on every draw, so overlays stay pinned
// across zoom/pan. refLinePlugin is optionally interactive (drag to move a line);
// the rest are pure draw hooks. The active drag-gesture tools live in uplotTools.

import type uPlot from "uplot";

import { hitTestAnnotationBody, hitTestAnnotationHandle, overPointerToCanvas } from "./annotationHit";
import { CLICK_PX } from "./pointGesture";
import type { ColorScatterSpec } from "./colorscatter";
import { colormap, normalize } from "./colormap";
import type { Annotation, RefLine, RegionShade } from "./types";

/** A reference line the pointer is over (for drag hit-testing). */
export interface RefLineHit {
  id: string;
  axis: "x" | "y";
}

/** Pick the reference line nearest the pointer within `tol` px, or null. Each
 *  candidate carries its on-axis pixel: x-lines are vertical (compare pointer.x),
 *  y-lines horizontal (compare pointer.y). Ties resolve to the closest. */
export function pickRefLine(
  candidates: { id: string; axis: "x" | "y"; px: number }[],
  pointer: { x: number; y: number },
  tol = 6,
): RefLineHit | null {
  let best: RefLineHit | null = null;
  let bestDist = tol;
  for (const c of candidates) {
    if (!Number.isFinite(c.px)) continue;
    const d = Math.abs((c.axis === "x" ? pointer.x : pointer.y) - c.px);
    if (d <= bestDist) {
      bestDist = d;
      best = { id: c.id, axis: c.axis };
    }
  }
  return best;
}

/** Draw dashed reference lines at fixed X/Y values, clipped to the plot area.
 *  When `opts.interactive` and `opts.onMove` are given, lines become draggable:
 *  the pointer near a line shows a resize cursor and a drag moves it. The live
 *  position is held plugin-locally (canvas redraw only) and committed to the
 *  store once on release — so the plot isn't rebuilt on every mouse move. */
export function refLinePlugin(
  lines: RefLine[],
  color: string,
  opts?: { onMove?: (id: string, value: number) => void; interactive?: boolean },
): uPlot.Plugin {
  // Live override for the line being dragged (null = nothing dragging).
  let dragId: string | null = null;
  let dragValue = 0;

  return {
    hooks: {
      ready:
        opts?.interactive && opts.onMove
          ? (u: uPlot) => {
              const over = u.over;
              const onMove = opts.onMove!;
              // The line's pixel in *plot-area* space (canvasPixels=false), to
              // match pointer coords measured from over's top-left.
              const hit = (clientX: number, clientY: number): RefLineHit | null => {
                const rect = over.getBoundingClientRect();
                const cands = lines.map((ln) => ({
                  id: ln.id,
                  axis: ln.axis,
                  px: u.valToPos(ln.value, ln.axis === "x" ? "x" : "y"),
                }));
                return pickRefLine(cands, { x: clientX - rect.left, y: clientY - rect.top });
              };

              over.addEventListener("mousemove", (e: MouseEvent) => {
                if (dragId) return; // cursor managed during drag
                const h = hit(e.clientX, e.clientY);
                over.style.cursor = h ? (h.axis === "x" ? "ew-resize" : "ns-resize") : "";
              });

              over.addEventListener(
                "mousedown",
                (e: MouseEvent) => {
                  if (e.button !== 0) return;
                  const h = hit(e.clientX, e.clientY);
                  if (!h) return; // not on a line → let uPlot box-zoom proceed
                  e.preventDefault();
                  e.stopPropagation(); // capture-phase: beat uPlot's drag handler
                  const rect = over.getBoundingClientRect();
                  const valAt = (ev: MouseEvent) =>
                    h.axis === "x"
                      ? u.posToVal(ev.clientX - rect.left, "x")
                      : u.posToVal(ev.clientY - rect.top, "y");
                  dragId = h.id;
                  dragValue = lines.find((l) => l.id === h.id)?.value ?? valAt(e);

                  const move = (ev: MouseEvent) => {
                    dragValue = valAt(ev);
                    u.redraw();
                  };
                  const up = (ev: MouseEvent) => {
                    const v = valAt(ev);
                    document.removeEventListener("mousemove", move);
                    document.removeEventListener("mouseup", up);
                    dragId = null;
                    over.style.cursor = "";
                    onMove(h.id, v); // commit once
                  };
                  document.addEventListener("mousemove", move);
                  document.addEventListener("mouseup", up);
                },
                { capture: true },
              );
            }
          : undefined,
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        for (const ln of lines) {
          // Use the live drag value for the line under the cursor.
          const value = ln.id === dragId ? dragValue : ln.value;
          if (!Number.isFinite(value)) continue;
          ctx.beginPath();
          if (ln.axis === "x") {
            const px = u.valToPos(value, "x", true);
            if (px < left || px > left + width) continue;
            ctx.moveTo(px, top);
            ctx.lineTo(px, top + height);
          } else {
            const py = u.valToPos(value, "y", true);
            if (py < top || py > top + height) continue;
            ctx.moveTo(left, py);
            ctx.lineTo(left + width, py);
          }
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}

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
}
export function annotationLayout(
  u: Pick<uPlot, "valToPos" | "ctx" | "bbox" | "scales">,
  a: Annotation,
  baseFont: string,
): AnnotationLayout | null {
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
  const hasY2 = u.scales.y2 != null;
  const yScale = a.axis === 1 && hasY2 ? "y2" : "y";
  const px = u.valToPos(a.x, "x", true);
  const py = u.valToPos(a.y, yScale, true);
  const font = annotationFont(baseFont, a.size);
  u.ctx.font = font;
  const textWidth = a.text ? u.ctx.measureText(a.text).width : 0;
  // Label clamping bounds are the whole CANVAS, not the axes bbox: a dragged
  // annotation may legitimately live in the margins (Origin's model — owner
  // report 2026-07-11: dragging the "700 mT" label outside the axes box made
  // it vanish). Fall back to the bbox for stub contexts without a canvas.
  const canvasW = u.ctx.canvas?.width ?? u.bbox.left + u.bbox.width;
  const { x: tx, align } = clampAnnotationLabelX(px, textWidth, 6, 0, canvasW);
  const lineHeight = fontPx(font) * 1.3;
  const ty = Math.max(py - 2, lineHeight);
  return { px, py, tx, ty, textWidth, align, lineHeight };
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
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, size: number) => void;
  onEditText?: (id: string) => void;
  onContextMenu?: (id: string, clientX: number, clientY: number) => void;
  /** Double-click on EMPTY canvas — reset the zoom through the store (clears
   *  committed axis limits, which uPlot's internal dblclick-autoscale can't). */
  onResetView?: () => void;
}

export function annotationPlugin(
  annotations: Annotation[],
  color: string,
  font: string,
  opts?: AnnotationEditOpts,
): uPlot.Plugin {
  // Live overrides while a pointer-mode gesture owns the pointer (plugin-
  // local canvas redraw only; the store commits ONCE on release).
  let dragMove: { id: string; x: number; y: number } | null = null;
  let dragResize: { id: string; size: number } | null = null;
  let destroyed = false;
  // Double-click-to-edit tracking (see the mousedown handler's doc for why
  // this isn't a native "dblclick" listener).
  let lastClickId: string | null = null;
  let lastClickTime = 0;
  let lastEmptyClickTime = 0;
  const DBLCLICK_MS = 400;

  const redrawSoon = (u: uPlot) =>
    requestAnimationFrame(() => {
      if (!destroyed) u.redraw();
    });

  /** The annotation actually drawn for `a` — its live drag/resize override
   *  when one is in flight, else itself unchanged. */
  const live = (a: Annotation): Annotation => {
    if (dragMove?.id === a.id) return { ...a, x: dragMove.x, y: dragMove.y };
    if (dragResize?.id === a.id) return { ...a, size: dragResize.size };
    return a;
  };

  return {
    hooks: {
      destroy: () => {
        destroyed = true;
      },
      ready:
        opts?.interactive
          ? (u: uPlot) => {
              const over = u.over;
              const o = opts;

              // Current on-canvas geometry for every annotation (live-override
              // aware) — recomputed per event, not cached: annotation counts
              // are small (a handful of labels), so this stays cheap.
              const geoms = () =>
                annotations
                  .map((a) => {
                    const layout = annotationLayout(u, live(a), font);
                    return layout ? { id: a.id, layout } : null;
                  })
                  .filter((v): v is { id: string; layout: AnnotationLayout } => v != null);
              const hitGeoms = (gs: { id: string; layout: AnnotationLayout }[]) =>
                gs.map((g) => ({ id: g.id, px: g.layout.px, py: g.layout.py, box: annotationBox(g.layout) }));
              const handleFor = (id: string, gs: { id: string; layout: AnnotationLayout }[]) => {
                const g = gs.find((x) => x.id === id);
                if (!g) return null;
                const box = annotationBox(g.layout);
                return box.width > 0
                  ? { x: box.left + box.width, y: box.top + box.height }
                  : { x: g.layout.px + 10, y: g.layout.py + 10 };
              };

              // Interaction surface = u.root (the WHOLE plot, axes margins
              // included) — a label dragged into the margin must stay
              // reachable (owner report 2026-07-11: outside the axes box it
              // "just is gone"). Pointer events arrive in CSS px relative to
              // root; the layout geometry is CANVAS px. root spans the canvas
              // exactly, so the conversion is overPointerToCanvas with the
              // full-canvas frame — see its doc for the DPR bug it fixes.
              const root = u.root;
              const canvasPointer = (rect: DOMRect, cssX: number, cssY: number) =>
                overPointerToCanvas(
                  { left: 0, top: 0, width: u.ctx.canvas.width, height: u.ctx.canvas.height },
                  rect,
                  cssX,
                  cssY,
                );
              // Clamp a dragged dot's DATA coords so its canvas position stays
              // on-canvas (pad px) — the drag can place a label in the margin
              // but never fully off the plot.
              const clampToCanvas = (x: number, y: number): { x: number; y: number } => {
                const pad = 6;
                const cw = u.ctx.canvas.width;
                const chh = u.ctx.canvas.height;
                if (cw <= 0 || chh <= 0) return { x, y };
                const rootRect = root.getBoundingClientRect();
                const overRect = over.getBoundingClientRect();
                const s = rootRect.width > 0 ? cw / rootRect.width : 1;
                const px = Math.min(Math.max(u.valToPos(x, "x", true), pad), cw - pad);
                const py = Math.min(Math.max(u.valToPos(y, "y", true), pad), chh - pad);
                const cssX = px / s - (overRect.left - rootRect.left);
                const cssY = py / s - (overRect.top - rootRect.top);
                return { x: u.posToVal(cssX, "x"), y: u.posToVal(cssY, "y") };
              };
              const setCursor = (c: string) => {
                root.style.cursor = c === "default" ? "" : c;
                over.style.cursor = c;
              };

              root.addEventListener("mousemove", (e: MouseEvent) => {
                if (dragMove || dragResize) return; // cursor fixed while a drag owns the pointer
                const rect = root.getBoundingClientRect();
                const p = canvasPointer(rect, e.clientX - rect.left, e.clientY - rect.top);
                const gs = geoms();
                const selId = o.selectedId ?? null;
                if (selId && hitTestAnnotationHandle(handleFor(selId, gs), p, 8 * p.scale)) {
                  setCursor("nwse-resize");
                  return;
                }
                setCursor(hitTestAnnotationBody(hitGeoms(gs), p, 8 * p.scale) ? "move" : "default");
              });

              root.addEventListener(
                "mousedown",
                (e: MouseEvent) => {
                  if (e.button !== 0) return;
                  const rect = root.getBoundingClientRect();
                  const down = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                  const downCanvas = canvasPointer(rect, down.x, down.y);
                  const gs = geoms();
                  const selId = o.selectedId ?? null;
                  const handle = selId ? handleFor(selId, gs) : null;

                  // Resize handle (only live for the currently-selected annotation).
                  if (selId && hitTestAnnotationHandle(handle, downCanvas, 8 * downCanvas.scale)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const a = annotations.find((x) => x.id === selId)!;
                    const startSize = a.size ?? fontPx(font);
                    dragResize = { id: selId, size: startSize };
                    const onMoveEv = (ev: MouseEvent) => {
                      // Drag down/right grows the label, up/left shrinks it —
                      // a plain vertical-distance-from-mousedown mapping (¼ px
                      // of size per px of drag) is simple and predictable; the
                      // final commit clamps to [MIN_ANNOTATION_SIZE, MAX_ANNOTATION_SIZE].
                      const dy = ev.clientY - rect.top - down.y;
                      dragResize = { id: selId, size: clampAnnotationSize(startSize + dy * 0.25) };
                      u.redraw();
                    };
                    const onUp = (ev: MouseEvent) => {
                      document.removeEventListener("mousemove", onMoveEv);
                      document.removeEventListener("mouseup", onUp);
                      const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                      // A plain click on the handle (no drag) commits nothing —
                      // same no-op-avoidance as the move gesture below.
                      if (dragResize && Math.hypot(up.x - down.x, up.y - down.y) >= CLICK_PX) {
                        o.onResize?.(dragResize.id, dragResize.size);
                      }
                      dragResize = null;
                      u.redraw();
                      redrawSoon(u);
                    };
                    document.addEventListener("mousemove", onMoveEv);
                    document.addEventListener("mouseup", onUp);
                    return;
                  }

                  const hit = hitTestAnnotationBody(hitGeoms(gs), downCanvas, 8 * downCanvas.scale);
                  if (hit == null) {
                    // Empty canvas: don't block uPlot's own drag (box zoom stays
                    // the pointer tool's muscle-memory gesture). A plain click
                    // (no drag) deselects; a DOUBLE click resets the zoom
                    // (owner ask 2026-07-11: an accidental box-zoom needs a
                    // fast way back) — through the store's resetView so
                    // committed xLim/yLim (e.g. an applied Origin figure's
                    // fixed ranges) clear too, which uPlot's own internal
                    // dblclick-autoscale cannot do.
                    const onUp = (ev: MouseEvent) => {
                      document.removeEventListener("mouseup", onUp);
                      const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                      if (Math.hypot(up.x - down.x, up.y - down.y) >= CLICK_PX) return;
                      const now = Date.now();
                      if (now - lastEmptyClickTime < DBLCLICK_MS) {
                        lastEmptyClickTime = 0;
                        // Internal-scale reset first (covers a limit-less box
                        // zoom); the store callback then clears committed lims.
                        u.setData(u.data);
                        o.onResetView?.();
                      } else {
                        lastEmptyClickTime = now;
                        o.onSelect?.(null);
                      }
                    };
                    document.addEventListener("mouseup", onUp);
                    return;
                  }

                  // On an annotation: own the gesture (capture-phase beats box zoom
                  // AND beats uPlot's own native dblclick-reset — see below).
                  e.preventDefault();
                  e.stopPropagation();
                  o.onSelect?.(hit);

                  // Double-click-to-edit, detected as two mousedowns on the SAME
                  // annotation within DBLCLICK_MS — NOT a native "dblclick"
                  // listener: uPlot binds its own dblclick-to-autoscale handler to
                  // this same `over` element during construction, which fires
                  // BEFORE a plugin's `ready` hook can attach anything (at-target
                  // listeners run in REGISTRATION order, not capture/bubble order),
                  // so a second `dblclick` listener here could race uPlot's own and
                  // still reset the zoom. Reusing the ALREADY-capture-phase
                  // mousedown handler (which already preempts uPlot for this
                  // gesture) sidesteps the race entirely.
                  const now = Date.now();
                  const isDblClick = lastClickId === hit && now - lastClickTime < DBLCLICK_MS;
                  lastClickId = hit;
                  lastClickTime = now;
                  if (isDblClick) {
                    o.onEditText?.(hit);
                    return;
                  }

                  const a = annotations.find((x) => x.id === hit)!;
                  dragMove = { id: hit, x: a.x, y: a.y };
                  // posToVal expects CSS px relative to `over` (the plot area),
                  // not `root` — and the distinction MATTERS on log/reciprocal
                  // scales where posToVal isn't affine.
                  const overRect = over.getBoundingClientRect();
                  const downOver = { x: e.clientX - overRect.left, y: e.clientY - overRect.top };
                  const onMoveEv = (ev: MouseEvent) => {
                    const nowX = ev.clientX - overRect.left;
                    const nowY = ev.clientY - overRect.top;
                    // Delta-based (not absolute posToVal-of-pointer): grabbing
                    // anywhere on the label keeps that grab point under the
                    // cursor, instead of snapping the dot to it. Clamped so the
                    // label can reach the margins but never leave the canvas.
                    const dxData = u.posToVal(nowX, "x") - u.posToVal(downOver.x, "x");
                    const dyData = u.posToVal(nowY, "y") - u.posToVal(downOver.y, "y");
                    const clamped = clampToCanvas(a.x + dxData, a.y + dyData);
                    dragMove = { id: hit, x: clamped.x, y: clamped.y };
                    u.redraw();
                  };
                  const onUp = (ev: MouseEvent) => {
                    document.removeEventListener("mousemove", onMoveEv);
                    document.removeEventListener("mouseup", onUp);
                    const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                    // A plain click (already selected via onSelect above, no
                    // actual drag) commits nothing — avoids a no-op store write
                    // + uPlot rebuild on every simple select click.
                    if (dragMove && Math.hypot(up.x - down.x, up.y - down.y) >= CLICK_PX) {
                      o.onMove?.(dragMove.id, dragMove.x, dragMove.y);
                    }
                    dragMove = null;
                    u.redraw();
                    redrawSoon(u);
                  };
                  document.addEventListener("mousemove", onMoveEv);
                  document.addEventListener("mouseup", onUp);
                },
                { capture: true },
              );

              root.addEventListener(
                "contextmenu",
                (e: MouseEvent) => {
                  const rect = root.getBoundingClientRect();
                  const p = canvasPointer(rect, e.clientX - rect.left, e.clientY - rect.top);
                  const hit = hitTestAnnotationBody(hitGeoms(geoms()), p, 8 * p.scale);
                  if (hit) {
                    e.preventDefault();
                    e.stopPropagation(); // don't fall through to the plot's own menu
                    o.onSelect?.(hit);
                    o.onContextMenu?.(hit, e.clientX, e.clientY);
                  }
                },
                { capture: true },
              );
            }
          : undefined,
      draw: (u: uPlot) => {
        const { ctx } = u;
        // Visibility bound = the CANVAS, not the axes bbox: margin-placed
        // labels (dragged there in pointer mode) must stay visible — only a
        // truly off-canvas anchor (e.g. far off-range after a zoom) skips.
        const cw = ctx.canvas?.width ?? u.bbox.left + u.bbox.width;
        const chh = ctx.canvas?.height ?? u.bbox.top + u.bbox.height;
        ctx.save();
        ctx.fillStyle = color;
        ctx.textBaseline = "bottom";
        for (const a0 of annotations) {
          const a = live(a0);
          const layout = annotationLayout(u, a, font);
          if (!layout) continue;
          const { px, py, tx, ty, align } = layout;
          if (px < 0 || px > cw || py < 0 || py > chh) continue;
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
          if (a.text) {
            ctx.font = annotationFont(font, a.size);
            ctx.textAlign = align;
            ctx.fillText(a.text, tx, ty);
          }
          // Selection outline + resize handle (pointer mode only).
          if (opts?.interactive && opts.selectedId === a0.id) {
            const selColor = opts.selectColor ?? color;
            const box = annotationBox(layout);
            ctx.save();
            ctx.strokeStyle = selColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            ctx.strokeRect(box.left - 3, box.top - 3, Math.max(box.width, 6) + 6, box.height + 6);
            ctx.setLineDash([]);
            const h =
              box.width > 0 ? { x: box.left + box.width, y: box.top + box.height } : { x: px + 10, y: py + 10 };
            ctx.fillStyle = selColor;
            ctx.fillRect(h.x - 3, h.y - 3, 6, 6);
            ctx.restore();
          }
        }
        ctx.restore();
      },
    },
  };
}

/** Draw vertical error-bar whiskers (y ± e) for selected data columns, with
 *  optional end caps. `errorsByCol` is keyed by uPlot data-column index
 *  (1-based); each value is the per-point error magnitude (null = no bar
 *  there). Each column's whiskers use that series' own y scale (primary or
 *  secondary). Clipped to the plot area so off-range whiskers don't bleed
 *  into the axes.
 *
 *  `capHalfWidth` (CSS px) defaults to 0 — bars only, no cross-stroke caps
 *  (owner 2026-07-09, item 3: "default is have the error bar cap width to
 *  zero"). The drawing still fully supports non-zero caps for a caller that
 *  opts in (e.g. a future per-plot preference) — only the DEFAULT changed. */
/** The fixed render alpha for Origin region shades: Origin's own
 *  fill-transparency field is UNDECODED (decode-plan #41 — no byte could be
 *  isolated across the corpus, see docs/origin_project_format.md §6.1), so
 *  this is a documented presentation choice — pale enough that data drawn
 *  over the band stays readable, matching Origin's pastel render. */
export const REGION_SHADE_ALPHA = 0.25;

/** Draw filled region rectangles (Origin `Rect*` bands — e.g. film-stack
 *  shading on an SLD profile, decode-plan #41) BEHIND the grid and data:
 *  the `drawClear` hook fires right after the canvas clears, before
 *  axes/grid/series paint over it — matching Origin, which draws these
 *  under everything. Extents are data coords re-derived on every draw
 *  (pinned across zoom/pan) and clipped to the plot area; a shade tagged
 *  `axis: 1` maps its y-extent through the y2 scale when the plot has one
 *  (same fallback rule as annotationPlugin). */
export function regionShadePlugin(shades: RegionShade[]): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const hasY2 = u.scales.y2 != null;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.globalAlpha = REGION_SHADE_ALPHA;
        for (const s of shades) {
          if (![s.x1, s.x2, s.y1, s.y2].every(Number.isFinite)) continue;
          const yScale = s.axis === 1 && hasY2 ? "y2" : "y";
          const xa = u.valToPos(s.x1, "x", true);
          const xb = u.valToPos(s.x2, "x", true);
          const ya = u.valToPos(s.y1, yScale, true);
          const yb = u.valToPos(s.y2, yScale, true);
          if (![xa, xb, ya, yb].every(Number.isFinite)) continue;
          ctx.fillStyle = s.fill;
          ctx.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
        }
        ctx.restore();
      },
    },
  };
}

export function errorBarsPlugin(
  errorsByCol: Map<number, (number | null)[]>,
  color: string,
  capHalfWidth = 0,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const xs = u.data[0];
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        for (const [col, errs] of errorsByCol) {
          const ys = u.data[col];
          if (!ys) continue;
          const scaleKey = u.series[col]?.scale ?? "y";
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i];
            const y = ys[i];
            const e = errs[i];
            if (x == null || y == null || e == null) continue;
            const px = u.valToPos(x, "x", true);
            const pHi = u.valToPos(y + e, scaleKey, true);
            const pLo = u.valToPos(y - e, scaleKey, true);
            ctx.beginPath();
            ctx.moveTo(px, pLo);
            ctx.lineTo(px, pHi);
            if (capHalfWidth > 0) {
              ctx.moveTo(px - capHalfWidth, pHi);
              ctx.lineTo(px + capHalfWidth, pHi);
              ctx.moveTo(px - capHalfWidth, pLo);
              ctx.lineTo(px + capHalfWidth, pLo);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      },
    },
  };
}

/** Default colour-mapped-scatter point diameter (CSS px) — matches the
 *  default marker size the regular per-series marker styling uses
 *  (`SeriesStyleCard`'s `NumberField` placeholder). */
const COLOR_SCATTER_SIZE = 5;

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
      draw: (u: uPlot) => {
        if (specs.size === 0) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const xs = u.data[0];
        const r = COLOR_SCATTER_SIZE / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        for (const [col, spec] of specs) {
          const ys = u.data[col];
          if (!ys) continue;
          const scaleKey = u.series[col]?.scale ?? "y";
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i];
            const y = ys[i];
            if (x == null || y == null) continue;
            const t = normalize(spec.z[i] ?? NaN, spec.lo, spec.hi, false);
            if (t == null) continue;
            const [rr, gg, bb] = colormap(spec.colormap, t);
            const px = u.valToPos(x, "x", true);
            const py = u.valToPos(y, scaleKey, true);
            ctx.beginPath();
            ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      },
    },
  };
}
