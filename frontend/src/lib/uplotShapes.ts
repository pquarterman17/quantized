// Drawn shapes on the plot (MAIN #27: arrow/line/rect/ellipse) — the draw
// pass renders every shape at its live geometry (data or page anchor, see
// `shapeLayout`); the pointer-mode `ready` hook composes TWO independent
// gestures, mutually exclusive per mousedown:
//   1. DRAW-NEW-SHAPE (`opts.drawKind` non-null): a capture-phase drag
//      anywhere on the canvas creates a new shape of that kind, live-
//      previewed, committed once on release via `onDrawCommit` — a plain
//      click (no drag) commits nothing, so the mode stays active for a
//      retry (the caller's `useShapeDraw` hook owns the "text box" click-
//      to-place special case; this plugin only ever emits Shape geometry).
//   2. SELECT/EDIT (`opts.interactive`): click-select / drag-move / handle-
//      drag reshape / right-click menu for EXISTING shapes — the same
//      capture-phase-beats-box-zoom + commit-once-on-release pattern
//      `uplotOverlays.annotationPlugin`/`refLinePlugin` use (see their
//      headers for the full reasoning; not repeated here).
// Hit-test geometry lives in `shapeHit.ts` (pure, canvas-stub-free — see its
// header); canvas-frame pointer conversion reuses `annotationHit.ts`'s
// `overPointerToCanvas`/`canvasToOverCss` — the DPR bug class documented
// there is NOT reimplemented here.
//
// Z-order: `uplotOpts.buildOpts` registers this plugin BETWEEN refLinePlugin
// and annotationPlugin, so shapes draw above series/ref-lines but below
// annotation TEXT (MAIN #27's spec) — plugin `draw` hooks paint in
// registration order, later = on top.

import type uPlot from "uplot";

import { canvasToOverCss, overPointerToCanvas } from "./annotationHit";
import { CLICK_PX } from "./pointGesture";
import {
  boundingEllipse,
  hitTestShapeBody,
  shapeHandles,
  shapeReshapeFields,
  type ShapeGeom,
} from "./shapeHit";
import type { Shape } from "./types";
import { canvasPxToPageXY, clampPageXY, pageXYToCanvasPx } from "./uplotOverlays";

/** Default whole-shape opacity (fill AND stroke, ONE knob — MAIN #27) when
 *  the shape carries no explicit override: 1 for line/arrow (a mark should
 *  read at full strength); 0.35 for rect/ellipse (so a freshly drawn box
 *  reads as visibly translucent OVER the data it's marking, never hiding
 *  it). */
export function defaultShapeOpacity(kind: Shape["kind"]): number {
  return kind === "rect" || kind === "ellipse" ? 0.35 : 1;
}

export function resolveShapeOpacity(shape: Pick<Shape, "kind" | "opacity">): number {
  return shape.opacity ?? defaultShapeOpacity(shape.kind);
}

/** Default stroke = the plot's own annotation ink color (matches every
 *  other un-styled overlay — ref lines, annotation text). */
export function resolveShapeStroke(shape: Pick<Shape, "stroke">, inkColor: string): string {
  return shape.stroke ?? inkColor;
}

/** Default fill = the shape's OWN resolved stroke — never a separately
 *  stored color (fill is only ever meaningful for rect/ellipse; callers
 *  simply don't apply it to arrow/line). */
export function resolveShapeFill(shape: Pick<Shape, "fill" | "stroke">, inkColor: string): string {
  return shape.fill ?? resolveShapeStroke(shape, inkColor);
}

export const DEFAULT_SHAPE_WIDTH = 1.5;

/** Canvas `setLineDash` array for a shape's `dash` flag — a fixed pattern,
 *  a bit heavier than `refLinePlugin`'s (a shape's stroke usually reads
 *  thicker than a hairline reference line). */
export function shapeDashArray(shape: Pick<Shape, "dash">): number[] {
  return shape.dash ? [9, 5] : [];
}

/** One shape's on-canvas geometry — the SINGLE implementation shared by the
 *  draw pass and the pointer-mode hit-test/selection outline (same "one
 *  geometry source" discipline as `uplotOverlays.annotationLayout` — see
 *  its header). Null for a non-finite endpoint (skip, matching every other
 *  overlay's convention). */
export interface ShapeLayout {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export function shapeLayout(
  u: Pick<uPlot, "valToPos" | "ctx" | "bbox">,
  shape: Pick<Shape, "x1" | "y1" | "x2" | "y2" | "anchor">,
): ShapeLayout | null {
  if (![shape.x1, shape.y1, shape.x2, shape.y2].every(Number.isFinite)) return null;
  if (shape.anchor === "page") {
    const canvasW = u.ctx.canvas?.width ?? u.bbox.left + u.bbox.width;
    const canvasH = u.ctx.canvas?.height ?? u.bbox.top + u.bbox.height;
    const p1 = pageXYToCanvasPx({ x: shape.x1, y: shape.y1 }, canvasW, canvasH);
    const p2 = pageXYToCanvasPx({ x: shape.x2, y: shape.y2 }, canvasW, canvasH);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }
  return {
    x1: u.valToPos(shape.x1, "x", true),
    y1: u.valToPos(shape.y1, "y", true),
    x2: u.valToPos(shape.x2, "x", true),
    y2: u.valToPos(shape.y2, "y", true),
  };
}

/** Draw one arrowhead (a small filled triangle) at (x2,y2), oriented along
 *  the p1->p2 direction. `size` is the CSS-px length along the shaft. */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - spread), y2 - size * Math.sin(angle - spread));
  ctx.lineTo(x2 - size * Math.cos(angle + spread), y2 - size * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

interface ResolvedShapeStyle {
  stroke: string;
  fill: string;
  opacity: number;
  width: number;
  dash: number[];
}

function drawOneShape(
  ctx: CanvasRenderingContext2D,
  kind: Shape["kind"],
  l: ShapeLayout,
  style: ResolvedShapeStyle,
): void {
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.fill;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash);
  if (kind === "line" || kind === "arrow") {
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
    if (kind === "arrow") {
      ctx.setLineDash([]);
      drawArrowhead(ctx, l.x1, l.y1, l.x2, l.y2, 8 + style.width * 2);
    }
  } else if (kind === "rect") {
    const x = Math.min(l.x1, l.x2);
    const y = Math.min(l.y1, l.y2);
    const w = Math.abs(l.x2 - l.x1);
    const h = Math.abs(l.y2 - l.y1);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  } else {
    const { cx, cy, rx, ry } = boundingEllipse(l.x1, l.y1, l.x2, l.y2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A shape's data<->page anchor conversion (MAIN #27, mirrors
 *  `uplotOverlays.annotationAnchorConversions`) — both endpoints, computed
 *  from the shape's CURRENT on-canvas position regardless of its CURRENT
 *  anchor. The object-menu toggle (`useShapeEdit`) picks whichever
 *  direction matches the requested pin, so the shape's on-screen position
 *  never jumps when the anchor flips. */
export interface ShapeAnchorConversion {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export function shapeAnchorConversions(
  u: Pick<uPlot, "ctx" | "posToVal" | "root" | "over">,
  layout: ShapeLayout,
): { toPage: ShapeAnchorConversion; toData: ShapeAnchorConversion } {
  const canvasW = u.ctx.canvas?.width ?? 0;
  const canvasH = u.ctx.canvas?.height ?? 0;
  const p1 = canvasPxToPageXY(layout.x1, layout.y1, canvasW, canvasH);
  const p2 = canvasPxToPageXY(layout.x2, layout.y2, canvasW, canvasH);
  const rootRect = u.root.getBoundingClientRect();
  const overRect = u.over.getBoundingClientRect();
  const frame = { width: canvasW, height: canvasH };
  const o1 = canvasToOverCss({ x: layout.x1, y: layout.y1 }, frame, rootRect, overRect);
  const o2 = canvasToOverCss({ x: layout.x2, y: layout.y2 }, frame, rootRect, overRect);
  return {
    toPage: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
    toData: {
      x1: u.posToVal(o1.x, "x"),
      y1: u.posToVal(o1.y, "y"),
      x2: u.posToVal(o2.x, "x"),
      y2: u.posToVal(o2.y, "y"),
    },
  };
}

export interface ShapeEditOpts {
  /** Non-null id draws a selection outline + handles for that ONE shape. */
  selectedId?: string | null;
  /** Wires the select/move/reshape/menu handlers below. */
  interactive?: boolean;
  selectColor?: string;
  onSelect?: (id: string | null) => void;
  /** Commit a completed body-drag move: the shape's NEW endpoints. */
  onMove?: (id: string, x1: number, y1: number, x2: number, y2: number) => void;
  /** Commit a completed handle-drag reshape (see `shapeHit.shapeReshapeFields`
   *  for which fields a given handle index patches). */
  onReshape?: (id: string, patch: Partial<Pick<Shape, "x1" | "y1" | "x2" | "y2">>) => void;
  onContextMenu?: (
    id: string,
    clientX: number,
    clientY: number,
    conv: { toPage: ShapeAnchorConversion; toData: ShapeAnchorConversion },
  ) => void;
  /** Non-null while a shape-DRAWING mode is active (dock flyout / Insert
   *  menu pick) — a drag anywhere on the canvas creates a new shape of this
   *  kind, independent of `interactive`/the toolbar tool (composes like
   *  peakWizardEdit/anchorEdit). Always drags in DATA coords — a page-pin is
   *  a later right-click action, matching annotations. `"textbox"` isn't a
   *  `Shape` kind — the plugin treats it identically to a real kind for the
   *  GESTURE (so the click is captured on this same path instead of falling
   *  through to whatever tool is active), except it commits on ANY click
   *  (no drag needed — a text box is a POINT placement) and draws no live
   *  preview; `useShapeDraw` (the store-level caller) is what actually
   *  creates an annotation instead of a shape for this kind. */
  drawKind?: Shape["kind"] | "textbox" | null;
  /** Commit a completed draw gesture: movement >= CLICK_PX for a real shape
   *  kind, ANY click (including zero movement) for `"textbox"`. */
  onDrawCommit?: (kind: Shape["kind"] | "textbox", x1: number, y1: number, x2: number, y2: number) => void;
}

export function shapesPlugin(shapes: Shape[], inkColor: string, opts?: ShapeEditOpts): uPlot.Plugin {
  // Live overrides while a pointer-mode gesture owns the pointer (plugin-
  // local canvas redraw only; the store commits ONCE on release) — same
  // pattern as annotationPlugin's `dragMove`/`dragResize`.
  let dragMove: { id: string; x1: number; y1: number; x2: number; y2: number } | null = null;
  let dragReshape: { id: string; patch: Partial<Pick<Shape, "x1" | "y1" | "x2" | "y2">> } | null = null;
  let drawLive: { kind: Shape["kind"] | "textbox"; x1: number; y1: number; x2: number; y2: number } | null = null;
  let destroyed = false;

  const redrawSoon = (u: uPlot) =>
    requestAnimationFrame(() => {
      if (!destroyed) u.redraw();
    });

  const live = (s: Shape): Shape => {
    if (dragMove?.id === s.id) return { ...s, x1: dragMove.x1, y1: dragMove.y1, x2: dragMove.x2, y2: dragMove.y2 };
    if (dragReshape?.id === s.id) return { ...s, ...dragReshape.patch };
    return s;
  };

  return {
    hooks: {
      destroy: () => {
        destroyed = true;
      },
      ready:
        opts?.interactive || opts?.drawKind
          ? (u: uPlot) => {
              const root = u.root;
              const over = u.over;
              const o = opts;

              // Draw mode wants a crosshair over the WHOLE plot, independent
              // of hover position (unlike select mode's hover-dependent
              // move/default cursor below) — set once, since this hook only
              // (re)runs when a fresh uPlot instance picks up a NEW
              // `drawKind` (PlotViewport rebuilds on that dependency).
              if (o?.drawKind) {
                root.style.cursor = "crosshair";
                over.style.cursor = "crosshair";
              }

              const canvasPointer = (rect: DOMRect, cssX: number, cssY: number) =>
                overPointerToCanvas(
                  { left: 0, top: 0, width: u.ctx.canvas.width, height: u.ctx.canvas.height },
                  rect,
                  cssX,
                  cssY,
                );

              const geoms = (): { id: string; geom: ShapeGeom }[] =>
                shapes
                  .map((s) => {
                    const l = shapeLayout(u, live(s));
                    return l ? { id: s.id, geom: { id: s.id, kind: s.kind, ...l } } : null;
                  })
                  .filter((v): v is { id: string; geom: ShapeGeom } => v != null);

              const handlesFor = (id: string, gs: { id: string; geom: ShapeGeom }[]) => {
                const g = gs.find((x) => x.id === id);
                if (!g) return [];
                return shapeHandles(g.geom.kind, g.geom);
              };

              const setCursor = (c: string) => {
                root.style.cursor = c === "default" ? "" : c;
                over.style.cursor = c;
              };

              // ── DRAW-NEW-SHAPE mode ──────────────────────────────────────
              root.addEventListener(
                "mousedown",
                (e: MouseEvent) => {
                  if (e.button !== 0 || !o?.drawKind) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const kind = o.drawKind;
                  const rect = root.getBoundingClientRect();
                  const overRect = over.getBoundingClientRect();
                  const downOver = { x: e.clientX - overRect.left, y: e.clientY - overRect.top };
                  const down = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                  const startX = u.posToVal(downOver.x, "x");
                  const startY = u.posToVal(downOver.y, "y");
                  drawLive = { kind, x1: startX, y1: startY, x2: startX, y2: startY };
                  u.redraw();
                  const onMoveEv = (ev: MouseEvent) => {
                    const nowX = ev.clientX - overRect.left;
                    const nowY = ev.clientY - overRect.top;
                    drawLive = { kind, x1: startX, y1: startY, x2: u.posToVal(nowX, "x"), y2: u.posToVal(nowY, "y") };
                    u.redraw();
                  };
                  const onUp = (ev: MouseEvent) => {
                    document.removeEventListener("mousemove", onMoveEv);
                    document.removeEventListener("mouseup", onUp);
                    const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                    // "textbox" commits on ANY click (a point placement); a
                    // real shape kind needs actual drag travel — a plain
                    // click leaves the mode active for a retry.
                    const moved = Math.hypot(up.x - down.x, up.y - down.y) >= CLICK_PX;
                    if (drawLive && (kind === "textbox" || moved)) {
                      o.onDrawCommit?.(kind, drawLive.x1, drawLive.y1, drawLive.x2, drawLive.y2);
                    }
                    drawLive = null;
                    u.redraw();
                    redrawSoon(u);
                  };
                  document.addEventListener("mousemove", onMoveEv);
                  document.addEventListener("mouseup", onUp);
                },
                { capture: true },
              );

              if (!o?.interactive) return;

              root.addEventListener("mousemove", (e: MouseEvent) => {
                if (o.drawKind || dragMove || dragReshape) return;
                const rect = root.getBoundingClientRect();
                const p = canvasPointer(rect, e.clientX - rect.left, e.clientY - rect.top);
                const gs = geoms();
                const selId = o.selectedId ?? null;
                if (selId) {
                  const hs = handlesFor(selId, gs);
                  const hit = hs.some((h) => Math.hypot(h.x - p.x, h.y - p.y) <= 8 * p.scale);
                  if (hit) {
                    setCursor("nwse-resize");
                    return;
                  }
                }
                setCursor(hitTestShapeBody(gs.map((g) => g.geom), p, 8 * p.scale) ? "move" : "default");
              });

              root.addEventListener(
                "mousedown",
                (e: MouseEvent) => {
                  if (e.button !== 0 || o.drawKind) return;
                  const rect = root.getBoundingClientRect();
                  const down = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                  const downCanvas = canvasPointer(rect, down.x, down.y);
                  const gs = geoms();
                  const selId = o.selectedId ?? null;
                  const hs = selId ? handlesFor(selId, gs) : [];
                  const handleIdx = hs.findIndex((h) => Math.hypot(h.x - downCanvas.x, h.y - downCanvas.y) <= 8 * downCanvas.scale);

                  if (selId && handleIdx >= 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    const s = shapes.find((x) => x.id === selId)!;
                    const { xField, yField } = shapeReshapeFields(s.kind, handleIdx);
                    const overRect = over.getBoundingClientRect();
                    const onMoveEv = (ev: MouseEvent) => {
                      const nowOver = { x: ev.clientX - overRect.left, y: ev.clientY - overRect.top };
                      const patch: Partial<Pick<Shape, "x1" | "y1" | "x2" | "y2">> = {};
                      if (s.anchor === "page") {
                        const nowCanvas = canvasPointer(rect, ev.clientX - rect.left, ev.clientY - rect.top);
                        const cw = u.ctx.canvas.width;
                        const chh = u.ctx.canvas.height;
                        const page = cw > 0 && chh > 0 ? { x: nowCanvas.x / cw, y: nowCanvas.y / chh } : { x: s[xField], y: s[yField] };
                        patch[xField] = Math.min(1, Math.max(0, page.x));
                        patch[yField] = Math.min(1, Math.max(0, page.y));
                      } else {
                        patch[xField] = u.posToVal(nowOver.x, "x");
                        patch[yField] = u.posToVal(nowOver.y, "y");
                      }
                      dragReshape = { id: selId, patch };
                      u.redraw();
                    };
                    const onUp = (ev: MouseEvent) => {
                      document.removeEventListener("mousemove", onMoveEv);
                      document.removeEventListener("mouseup", onUp);
                      const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                      if (dragReshape && Math.hypot(up.x - down.x, up.y - down.y) >= CLICK_PX) {
                        o.onReshape?.(dragReshape.id, dragReshape.patch);
                      }
                      dragReshape = null;
                      u.redraw();
                      redrawSoon(u);
                    };
                    document.addEventListener("mousemove", onMoveEv);
                    document.addEventListener("mouseup", onUp);
                    return;
                  }

                  const hit = hitTestShapeBody(gs.map((g) => g.geom), downCanvas, 8 * downCanvas.scale);
                  if (hit == null) {
                    // Empty canvas: don't block uPlot's own drag (box zoom).
                    const onUp = (ev: MouseEvent) => {
                      document.removeEventListener("mouseup", onUp);
                      const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                      if (Math.hypot(up.x - down.x, up.y - down.y) < CLICK_PX) o.onSelect?.(null);
                    };
                    document.addEventListener("mouseup", onUp);
                    return;
                  }

                  e.preventDefault();
                  e.stopPropagation();
                  o.onSelect?.(hit);
                  const s = shapes.find((x) => x.id === hit)!;
                  dragMove = { id: hit, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };
                  const overRect = over.getBoundingClientRect();
                  const downOver = { x: e.clientX - overRect.left, y: e.clientY - overRect.top };
                  const onMoveEv = (ev: MouseEvent) => {
                    if (s.anchor === "page") {
                      const nowCanvas = canvasPointer(rect, ev.clientX - rect.left, ev.clientY - rect.top);
                      const cw = u.ctx.canvas.width;
                      const chh = u.ctx.canvas.height;
                      const dx = cw > 0 ? (nowCanvas.x - downCanvas.x) / cw : 0;
                      const dy = chh > 0 ? (nowCanvas.y - downCanvas.y) / chh : 0;
                      const c1 = clampPageXY(s.x1 + dx, s.y1 + dy, cw, chh);
                      const c2 = clampPageXY(s.x2 + dx, s.y2 + dy, cw, chh);
                      dragMove = { id: hit, x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y };
                      u.redraw();
                      return;
                    }
                    const nowX = ev.clientX - overRect.left;
                    const nowY = ev.clientY - overRect.top;
                    const dxData = u.posToVal(nowX, "x") - u.posToVal(downOver.x, "x");
                    const dyData = u.posToVal(nowY, "y") - u.posToVal(downOver.y, "y");
                    dragMove = { id: hit, x1: s.x1 + dxData, y1: s.y1 + dyData, x2: s.x2 + dxData, y2: s.y2 + dyData };
                    u.redraw();
                  };
                  const onUp = (ev: MouseEvent) => {
                    document.removeEventListener("mousemove", onMoveEv);
                    document.removeEventListener("mouseup", onUp);
                    const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                    if (dragMove && Math.hypot(up.x - down.x, up.y - down.y) >= CLICK_PX) {
                      o.onMove?.(dragMove.id, dragMove.x1, dragMove.y1, dragMove.x2, dragMove.y2);
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
                  const gs = geoms();
                  const hit = hitTestShapeBody(gs.map((g) => g.geom), p, 8 * p.scale);
                  if (hit) {
                    e.preventDefault();
                    e.stopPropagation();
                    o.onSelect?.(hit);
                    const g = gs.find((x) => x.id === hit)!;
                    o.onContextMenu?.(hit, e.clientX, e.clientY, shapeAnchorConversions(u, g.geom));
                  }
                },
                { capture: true },
              );
            }
          : undefined,
      draw: (u: uPlot) => {
        const { ctx } = u;
        for (const s0 of shapes) {
          const s = live(s0);
          const l = shapeLayout(u, s);
          if (!l) continue;
          const style: ResolvedShapeStyle = {
            stroke: resolveShapeStroke(s, inkColor),
            fill: s.kind === "rect" || s.kind === "ellipse" ? resolveShapeFill(s, inkColor) : "transparent",
            opacity: resolveShapeOpacity(s),
            width: s.width ?? DEFAULT_SHAPE_WIDTH,
            dash: shapeDashArray(s),
          };
          drawOneShape(ctx, s.kind, l, style);
          if (opts?.interactive && opts.selectedId === s0.id) {
            const selColor = opts.selectColor ?? inkColor;
            ctx.save();
            ctx.strokeStyle = selColor;
            ctx.fillStyle = selColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            const x = Math.min(l.x1, l.x2) - 4;
            const y = Math.min(l.y1, l.y2) - 4;
            const w = Math.abs(l.x2 - l.x1) + 8;
            const h = Math.abs(l.y2 - l.y1) + 8;
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
            for (const h2 of shapeHandles(s.kind, l)) {
              ctx.fillRect(h2.x - 3, h2.y - 3, 6, 6);
            }
            ctx.restore();
          }
        }
        // Live preview of an in-progress DRAW gesture — always full opacity/
        // dashed so it reads as a "not yet committed" ghost. "textbox" has
        // no shape preview (it's a point placement, committed on click —
        // see the mousedown handler's doc).
        if (drawLive && drawLive.kind !== "textbox") {
          const l = shapeLayout(u, drawLive);
          if (l) {
            drawOneShape(ctx, drawLive.kind, l, {
              stroke: inkColor,
              fill: drawLive.kind === "rect" || drawLive.kind === "ellipse" ? inkColor : "transparent",
              opacity: defaultShapeOpacity(drawLive.kind),
              width: DEFAULT_SHAPE_WIDTH,
              dash: [4, 3],
            });
          }
        }
      },
    },
  };
}
