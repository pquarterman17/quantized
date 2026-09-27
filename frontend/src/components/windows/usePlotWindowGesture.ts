// Live MDI move/resize preview without global-store churn. Pointer movement
// updates only the dragged frame's DOM geometry, at most once per animation
// frame; the final geometry enters Zustand once when the gesture ends. This
// keeps sibling plots and the focused PlotStage out of React's render path
// while a window is moving or resizing.

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";

import { type PlotWindow, type WindowGeometry } from "../../lib/plotview";
import { snapMovePosition, snapResizeGeometry, type ResizeEdges } from "../../lib/windowSnap";
import { useWindowsStore } from "../../store/hooks/useWindowsStore";
import { useApp } from "../../store/useApp";

export const MIN_PLOT_WINDOW_W = 240;
export const MIN_PLOT_WINDOW_H = 160;
const TITLE_MIN_VISIBLE = 80;
const TITLEBAR_H = 28;

export interface WindowBounds { width: number; height: number }

/** Clamp a title-bar-reachable position into `bounds` (no-op without bounds). */
export function clampPlotWindowPosition(x: number, y: number, bounds: WindowBounds | undefined) {
  if (!bounds) return { x: Math.max(0, x), y: Math.max(0, y) };
  return {
    x: Math.min(Math.max(0, x), Math.max(0, bounds.width - TITLE_MIN_VISIBLE)),
    y: Math.min(Math.max(0, y), Math.max(0, bounds.height - TITLEBAR_H)),
  };
}

export type ResizeEdge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
type DragMode = "move" | ResizeEdge;
interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  siblings: WindowGeometry[];
}

type PendingGeometry = WindowGeometry;
const END_GESTURE_EVENTS = ["pointerup", "pointercancel", "blur"] as const;

export function usePlotWindowGesture(win: PlotWindow, bounds: WindowBounds | undefined) {
  const moveWindow = useWindowsStore((s) => s.moveWindow);
  const resizeWindow = useWindowsStore((s) => s.resizeWindow);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<PendingGeometry | null>(null);
  // Separate from the id because tests and some embedded hosts may invoke a
  // frame callback synchronously, before requestAnimationFrame returns.
  const previewScheduledRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const preview = useCallback(() => {
    previewScheduledRef.current = false;
    rafIdRef.current = null;
    const pending = pendingRef.current;
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!pending || !drag || !frame) return;
    frame.style.left = `${pending.x}px`;
    frame.style.top = `${pending.y}px`;
    frame.style.width = `${pending.w}px`;
    frame.style.height = `${pending.h}px`;
  }, []);

  const schedulePreview = useCallback((geometry: WindowGeometry) => {
    pendingRef.current = geometry;
    if (previewScheduledRef.current) return;
    previewScheduledRef.current = true;
    const id = requestAnimationFrame(preview);
    if (previewScheduledRef.current) rafIdRef.current = id;
  }, [preview]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.mode === "move") {
      let x = drag.origX + dx;
      let y = drag.origY + dy;
      if (!e.altKey) ({ x, y } = snapMovePosition(
        { x, y, w: drag.origW, h: drag.origH }, bounds, drag.siblings,
      ));
      const clamped = clampPlotWindowPosition(x, y, bounds);
      schedulePreview({ ...clamped, w: drag.origW, h: drag.origH });
      return;
    }
    const moving: ResizeEdges = {
      n: drag.mode.includes("n"), e: drag.mode.includes("e"),
      s: drag.mode.includes("s"), w: drag.mode.includes("w"),
    };
    const right = drag.origX + drag.origW;
    const bottom = drag.origY + drag.origH;
    let geometry: WindowGeometry = {
      x: moving.w ? Math.min(drag.origX + dx, right - MIN_PLOT_WINDOW_W) : drag.origX,
      y: moving.n ? Math.min(drag.origY + dy, bottom - MIN_PLOT_WINDOW_H) : drag.origY,
      w: moving.w ? Math.max(MIN_PLOT_WINDOW_W, drag.origW - dx)
        : moving.e ? Math.max(MIN_PLOT_WINDOW_W, drag.origW + dx) : drag.origW,
      h: moving.n ? Math.max(MIN_PLOT_WINDOW_H, drag.origH - dy)
        : moving.s ? Math.max(MIN_PLOT_WINDOW_H, drag.origH + dy) : drag.origH,
    };
    if (!e.altKey) {
      geometry = snapResizeGeometry(geometry, moving, bounds, drag.siblings);
      if (geometry.w < MIN_PLOT_WINDOW_W) {
        if (moving.w) geometry.x = right - MIN_PLOT_WINDOW_W;
        geometry.w = MIN_PLOT_WINDOW_W;
      }
      if (geometry.h < MIN_PLOT_WINDOW_H) {
        if (moving.n) geometry.y = bottom - MIN_PLOT_WINDOW_H;
        geometry.h = MIN_PLOT_WINDOW_H;
      }
    }
    schedulePreview(geometry);
  }, [bounds, schedulePreview]);

  const finishGesture = useCallback(() => {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    // Pointerup can arrive before the queued paint. Apply the final preview
    // first, then commit that exact pair to the store once.
    preview();
    const drag = dragRef.current;
    const pending = pendingRef.current;
    if (drag && pending) {
      const changed = pending.x !== drag.origX || pending.y !== drag.origY
        || pending.w !== drag.origW || pending.h !== drag.origH;
      if (changed) {
        useApp.getState().recordHistory(drag.mode === "move" ? "move window" : "resize window");
        if (pending.x !== drag.origX || pending.y !== drag.origY) moveWindow(win.id, pending.x, pending.y);
        if (pending.w !== drag.origW || pending.h !== drag.origH) resizeWindow(win.id, pending.w, pending.h);
      }
    }
    frameRef.current?.classList.remove("gesturing");
    dragRef.current = null;
    pendingRef.current = null;
    previewScheduledRef.current = false;
    rafIdRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    END_GESTURE_EVENTS.forEach((event) => window.removeEventListener(event, finishGesture));
  }, [moveWindow, onPointerMove, preview, resizeWindow, win.id]);

  useEffect(() => () => {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    previewScheduledRef.current = false;
    window.removeEventListener("pointermove", onPointerMove);
    END_GESTURE_EVENTS.forEach((event) => window.removeEventListener(event, finishGesture));
  }, [finishGesture, onPointerMove]);

  const beginDrag = (mode: DragMode) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || win.winState === "maximized") return;
    e.preventDefault();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: win.geometry.x,
      origY: win.geometry.y,
      origW: win.geometry.w,
      origH: win.geometry.h,
      siblings: useApp.getState().plotWindows
        .filter((candidate) => candidate.id !== win.id && candidate.winState !== "minimized")
        .map((candidate) => candidate.geometry),
    };
    pendingRef.current = null;
    frameRef.current?.classList.add("gesturing");
    window.addEventListener("pointermove", onPointerMove);
    END_GESTURE_EVENTS.forEach((event) => window.addEventListener(event, finishGesture));
  };

  return { frameRef, beginDrag };
}
