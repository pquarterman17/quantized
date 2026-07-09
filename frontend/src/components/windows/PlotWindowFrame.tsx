// The MDI chrome around one plot window's content (MULTI_PLOT_PLAN item 3):
// a draggable title bar (window title + dataset badge), a resize grip, a
// close button, and a focus highlight using `--accent`. Geometry/z mutations
// flow through the existing store actions (moveWindow/resizeWindow/
// raiseWindow/focusWindow — Key Decision 3), rAF-throttled so a fast native
// drag doesn't fire a store update (and a React re-render) per pointermove.
//
// A separate component from `overlays/ToolWindow` (the 24-consumer workshop
// floating panel): that one is deliberately store-decoupled with fixed width
// and no resize/persistence; this one is store-controlled geometry with
// resize, because plot windows need it and workshops don't (Key Decision 3).
// It shares the `qzk-win*` naming FAMILY (see shell.css) under a distinct
// `qzk-plotwin*` prefix so the two don't collide in the stylesheet.

import { type ReactNode, useCallback, useEffect, useRef } from "react";

import type { PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";

export interface PlotWindowFrameProps {
  win: PlotWindow;
  focused: boolean;
  /** Dataset display name for the title-bar badge (undefined = unbound /
   *  removed dataset — see MULTI_PLOT_PLAN decision #4). */
  datasetName: string | undefined;
  /** The hosting canvas's current size (from `WindowCanvas`'s own
   *  ResizeObserver) — used to keep the title bar reachable (never fully
   *  off-canvas), both live while dragging and reactively when the canvas
   *  itself resizes. Undefined (e.g. in isolation/tests) skips clamping. */
  bounds?: { width: number; height: number };
  children: ReactNode;
}

const MIN_W = 240;
const MIN_H = 160;
// A dragged/reflowed window always keeps at least this much of its title bar
// on-canvas, so it's never lost off-screen (item 3's "geometry clamped to
// the canvas" requirement).
const TITLE_MIN_VISIBLE = 80;
const TITLEBAR_H = 28;

/** Clamp a title-bar-reachable position into `bounds` (no-op without bounds). */
function clampPos(x: number, y: number, bounds: { width: number; height: number } | undefined) {
  if (!bounds) return { x: Math.max(0, x), y: Math.max(0, y) };
  return {
    x: Math.min(Math.max(0, x), Math.max(0, bounds.width - TITLE_MIN_VISIBLE)),
    y: Math.min(Math.max(0, y), Math.max(0, bounds.height - TITLEBAR_H)),
  };
}

type DragMode = "move" | "resize";
interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

export default function PlotWindowFrame({
  win,
  focused,
  datasetName,
  bounds,
  children,
}: PlotWindowFrameProps) {
  const moveWindow = useApp((s) => s.moveWindow);
  const resizeWindow = useApp((s) => s.resizeWindow);
  const focusWindow = useApp((s) => s.focusWindow);
  const closeWindow = useApp((s) => s.closeWindow);

  // Canvas-resize reflow: whenever the hosting canvas changes size, re-clamp
  // this window's position so its title bar stays reachable (a browser-
  // window shrink can otherwise strand a window's grab handle off-canvas).
  useEffect(() => {
    if (!bounds || win.winState === "maximized") return;
    const clamped = clampPos(win.geometry.x, win.geometry.y, bounds);
    if (clamped.x !== win.geometry.x || clamped.y !== win.geometry.y) {
      moveWindow(win.id, clamped.x, clamped.y);
    }
    // Only re-run when the CANVAS resizes or this window's identity changes —
    // not on every geometry tick (that would fight live dragging).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds?.width, bounds?.height, win.id, win.winState]);

  // rAF-throttled drag/resize: the native pointermove handler just records the
  // latest pointer position; a single rAF callback flushes it into the store,
  // so a fast drag fires at most one store update (React re-render) per frame
  // instead of one per native mousemove. `scheduledRef` (not `rafIdRef`) is
  // the "is a flush pending" gate — kept separate from the cancellation
  // handle so a synchronous `requestAnimationFrame` (real browsers never do
  // this; a test stub might) can't have its own reset-to-null clobbered by
  // the outer `rafIdRef.current = requestAnimationFrame(...)` assignment
  // completing (in real order) AFTER the callback already ran.
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<{ a: number; b: number } | null>(null);
  const scheduledRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    scheduledRef.current = false;
    rafIdRef.current = null;
    const pending = pendingRef.current;
    const drag = dragRef.current;
    if (!pending || !drag) return;
    if (drag.mode === "move") moveWindow(win.id, pending.a, pending.b);
    else resizeWindow(win.id, pending.a, pending.b);
  }, [win.id, moveWindow, resizeWindow]);

  const schedule = useCallback(
    (a: number, b: number) => {
      pendingRef.current = { a, b };
      if (!scheduledRef.current) {
        scheduledRef.current = true;
        rafIdRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (drag.mode === "move") {
        const p = clampPos(drag.origX + dx, drag.origY + dy, bounds);
        schedule(p.x, p.y);
      } else {
        schedule(Math.max(MIN_W, drag.origW + dx), Math.max(MIN_H, drag.origH + dy));
      }
    },
    [schedule, bounds],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  useEffect(
    () => () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  const beginDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: win.geometry.x,
      origY: win.geometry.y,
      origW: win.geometry.w,
      origH: win.geometry.h,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Any pointer activity anywhere in the frame (title bar, body, grip) raises
  // + focuses it first — the item-4 "background frames focus on pointerdown"
  // contract, implemented ONCE here (capture phase, so it runs before uPlot's
  // own native mousedown listeners on the canvas beneath — capture visits
  // this ancestor on the way down, before the event ever reaches the target).
  const onFrameCapture = () => {
    if (!focused) focusWindow(win.id);
  };

  const maximized = win.winState === "maximized";
  const style: React.CSSProperties = maximized
    ? { position: "absolute", inset: 0 }
    : {
        position: "absolute",
        left: win.geometry.x,
        top: win.geometry.y,
        width: win.geometry.w,
        height: win.geometry.h,
        zIndex: win.z,
      };

  return (
    <div
      className={`qzk-plotwin${focused ? " focused" : ""}`}
      style={style}
      onPointerDownCapture={onFrameCapture}
    >
      <div className="qzk-plotwin-titlebar" onPointerDown={beginDrag("move")}>
        <span className="qzk-plotwin-title">{win.title || datasetName || "Untitled graph"}</span>
        {datasetName && <span className="qzk-plotwin-badge">{datasetName}</span>}
        <button
          type="button"
          className="qzk-plotwin-close"
          aria-label="Close window"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => closeWindow(win.id)}
        />
      </div>
      <div className="qzk-plotwin-body">{children}</div>
      {!maximized && (
        <div
          className="qzk-plotwin-resize"
          aria-hidden="true"
          onPointerDown={beginDrag("resize")}
        />
      )}
    </div>
  );
}
