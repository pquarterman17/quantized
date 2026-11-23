// The text-annotation draw + pointer plugin, split out of lib/uplotOverlays.ts
// as a STARTUP CHUNK for the eager budget (bundle diet slice 31): loaded right
// after startup by lib/annotationsLoader.ts, read by `uplotOpts.buildOpts`
// through `loadedAnnotations()`. The geometry (`annotationLayout`,
// `annotationBox`, ...) and the edit-option types stay in uplotOverlays.ts,
// shared with the inspector and the pointer tool.
import type uPlot from "uplot";
import {
  claimCursor,
  cursorClaimed,
  hitTestAnnotationBody,
  hitTestAnnotationHandle,
  overPointerToCanvas,
} from "./annotationHit";
import { CLICK_PX } from "./pointGesture";
import { DESCENT_EM, drawRich } from "./richtextCanvas";

import type { Annotation } from "./types";
import {
  annotationAnchorConversions,
  annotationBox,
  annotationFont,
  annotationLayout,
  annotationRichFont,
  type AnnotationLayout,
  clampPageXY,
  clampToCanvas,
  DEFAULT_FRAME_PAD,
  fontPx,
  resolveFrameFill,
  resolveFrameOpacity,
  resolveFrameStroke,
  type AnnotationEditOpts,
} from "./annotationGeometry";
import { clampAnnotationSize } from "./uplotOverlays";
const MOVE = "mousemove", UP = "mouseup";

/** Draw an annotation's `frame` (MAIN #27's "text box") — a filled+stroked
 *  rect BEHIND its text, padded around the SAME `annotationBox` the hit-test
 *  and selection outline use (one geometry, never drifts). A no-op for an
 *  annotation with no `frame`. */
function drawAnnotationFrame(
  ctx: CanvasRenderingContext2D,
  box: { left: number; top: number; width: number; height: number },
  frame: NonNullable<Annotation["frame"]>,
  inkColor: string,
  paperColor: string,
): void {
  const pad = frame.pad ?? DEFAULT_FRAME_PAD;
  ctx.save();
  ctx.globalAlpha = resolveFrameOpacity(frame);
  ctx.fillStyle = resolveFrameFill(frame, paperColor);
  ctx.strokeStyle = resolveFrameStroke(frame, inkColor);
  ctx.lineWidth = 1;
  const x = box.left - pad;
  const y = box.top - pad;
  const w = Math.max(box.width, 1) + pad * 2;
  const h = box.height + pad * 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
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
              const setCursor = (c: string) => {
                root.style.cursor = c === "default" ? "" : c;
                over.style.cursor = c;
              };

              root.addEventListener(MOVE, (e: MouseEvent) => {
                if (dragMove || dragResize) return; // cursor fixed while a drag owns the pointer
                const rect = root.getBoundingClientRect();
                const p = canvasPointer(rect, e.clientX - rect.left, e.clientY - rect.top);
                const gs = geoms();
                const selId = o.selectedId ?? null;
                if (selId && hitTestAnnotationHandle(handleFor(selId, gs), p, 8 * p.scale)) {
                  setCursor("nwse-resize");
                  claimCursor(e);
                  return;
                }
                // Bug 2: only WRITE a cursor on our own positive hit, or on a
                // miss that no earlier same-event listener already claimed
                // (shapesPlugin registers on this same root FIRST — see
                // claimCursor's doc) — otherwise a shape's "move" cursor gets
                // clobbered back to "default" by this plugin's own miss.
                if (hitTestAnnotationBody(hitGeoms(gs), p, 8 * p.scale)) {
                  setCursor("move");
                  claimCursor(e);
                } else if (!cursorClaimed(e)) {
                  setCursor("default");
                }
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
                    // stopImmediatePropagation (not just stopPropagation): shapesPlugin
                    // shares this SAME root node for its own capture-phase mousedown
                    // listener — plain stopPropagation() does NOT stop a sibling
                    // listener on the SAME node, only propagation to the NEXT node
                    // (bug-hunt Bug 1). This branch OWNS the gesture, so it must claim
                    // the event outright.
                    e.stopImmediatePropagation();
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
                      document.removeEventListener(MOVE, onMoveEv);
                      document.removeEventListener(UP, onUp);
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
                    document.addEventListener(MOVE, onMoveEv);
                    document.addEventListener(UP, onUp);
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
                      document.removeEventListener(UP, onUp);
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
                    document.addEventListener(UP, onUp);
                    return;
                  }

                  // On an annotation: own the gesture (capture-phase beats box zoom
                  // AND beats uPlot's own native dblclick-reset — see below).
                  // stopImmediatePropagation (bug-hunt Bug 1): see the resize-handle
                  // branch's doc above — a plain stopPropagation() left this SAME
                  // mousedown reaching a sibling shapesPlugin listener registered on
                  // the same root, which then ran its OWN empty-hit branch (a click on
                  // an annotation isn't a hit on any shape) and reset zoom/deselected.
                  e.preventDefault();
                  e.stopImmediatePropagation();
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
                    if (a.anchor === "page") {
                      // MAIN #21: a page annotation has no data scale to drag
                      // through — accumulate the delta in CANVAS px instead
                      // (reusing `rect`/`downCanvas`, the same root-relative
                      // canvas pointer already captured for hit-testing at
                      // mousedown) and convert to a FRACTION delta by dividing
                      // by the canvas dims, clamped by `clampPageXY` (the
                      // page-space analogue of `clampToCanvas`'s pad).
                      const nowCanvas = canvasPointer(rect, ev.clientX - rect.left, ev.clientY - rect.top);
                      const cw = u.ctx.canvas.width;
                      const chh = u.ctx.canvas.height;
                      const dx = cw > 0 ? (nowCanvas.x - downCanvas.x) / cw : 0;
                      const dy = chh > 0 ? (nowCanvas.y - downCanvas.y) / chh : 0;
                      const clampedPage = clampPageXY(a.x + dx, a.y + dy, cw, chh);
                      dragMove = { id: hit, x: clampedPage.x, y: clampedPage.y };
                      u.redraw();
                      return;
                    }
                    const nowX = ev.clientX - overRect.left;
                    const nowY = ev.clientY - overRect.top;
                    // Delta-based (not absolute posToVal-of-pointer): grabbing
                    // anywhere on the label keeps that grab point under the
                    // cursor, instead of snapping the dot to it. Clamped so the
                    // label can reach the margins but never leave the canvas.
                    const dxData = u.posToVal(nowX, "x") - u.posToVal(downOver.x, "x");
                    const dyData = u.posToVal(nowY, "y") - u.posToVal(downOver.y, "y");
                    const clamped = clampToCanvas(u, a.x + dxData, a.y + dyData);
                    dragMove = { id: hit, x: clamped.x, y: clamped.y };
                    u.redraw();
                  };
                  const onUp = (ev: MouseEvent) => {
                    document.removeEventListener(MOVE, onMoveEv);
                    document.removeEventListener(UP, onUp);
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
                  document.addEventListener(MOVE, onMoveEv);
                  document.addEventListener(UP, onUp);
                },
                { capture: true },
              );

              root.addEventListener(
                "contextmenu",
                (e: MouseEvent) => {
                  const rect = root.getBoundingClientRect();
                  const p = canvasPointer(rect, e.clientX - rect.left, e.clientY - rect.top);
                  const gs = geoms();
                  const hit = hitTestAnnotationBody(hitGeoms(gs), p, 8 * p.scale);
                  if (hit) {
                    e.preventDefault();
                    // stopImmediatePropagation: don't fall through to the plot's own
                    // menu NOR to a sibling shapesPlugin contextmenu listener sharing
                    // this same root (bug-hunt Bug 1).
                    e.stopImmediatePropagation();
                    o.onSelect?.(hit);
                    // MAIN #21: precompute the data<->page toggle conversion
                    // from the hit annotation's CURRENT on-canvas position —
                    // the React-side menu builder has no live uPlot instance
                    // to compute this itself (see AnnotationEditOpts.onContextMenu's doc).
                    const a = annotations.find((x) => x.id === hit)!;
                    const g = gs.find((x) => x.id === hit)!;
                    o.onContextMenu?.(hit, e.clientX, e.clientY, annotationAnchorConversions(u, live(a), g.layout));
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
          // Frame (MAIN #27 "text box") draws BEHIND the dot+text, padded
          // around the same box the hit-test/selection outline use.
          if (a.text && a.frame) drawAnnotationFrame(ctx, annotationBox(layout), a.frame, color, opts?.paperColor ?? "transparent");
          if (a.dot !== false) {
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          if (a.text) {
            if (layout.rich) {
              // Reuse the SAME shared canvas renderer the axis-label plugin
              // draws with (richtextCanvas.ts) rather than a second rich
              // draw path — styled runs (italics, sub/sup, Greek) at the
              // annotation's own font size/color. drawRich always draws on
              // the ALPHABETIC baseline, so `ty` (this loop's BOTTOM
              // baseline, set via `ctx.textBaseline = "bottom"` above) is
              // converted the same way uplotRichLabels.ts converts uPlot's
              // bottom-anchored axis labels. Wrapped in its own save/restore
              // — drawRich mutates fillStyle/textAlign/textBaseline/font on
              // the SHARED canvas context, which would otherwise leak into
              // the next (possibly plain-text) annotation's fillText call.
              const richFont = annotationRichFont(font, a.size);
              const drawX = align === "right" ? tx - layout.textWidth : tx;
              ctx.save();
              drawRich(ctx, layout.rich, drawX, ty - DESCENT_EM * richFont.px, richFont, color);
              ctx.restore();
            } else {
              ctx.font = annotationFont(font, a.size);
              ctx.textAlign = align;
              ctx.fillText(a.text, tx, ty);
            }
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
