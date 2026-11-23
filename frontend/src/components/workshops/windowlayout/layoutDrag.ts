// Dragging a window's title bar to dock it (WORKSPACE_LAYOUT_PLAN P2). One
// session at a time, for a DOCKED title bar (the window follows the pointer as
// a ghost label) or a FLOATING one (the existing move machinery moves the
// frame; this session only watches the pointer for a drop zone, so there is
// no second drag system). While the pointer is in a zone the desk shows its
// preview (DropZones); releasing there docks through the pure model ops,
// releasing elsewhere floats a docked window at the drop point and leaves a
// floating one where the move put it. Holding Alt disables docking, as it
// disables snapping in a plot window's own move.
//
// The pointer is captured on the title bar, so a drag that leaves the window
// still ends on release; Escape cancels through the `gesture` layer of
// lib/escapeStack.ts and puts everything back; a pointercancel or a lost
// window focus cancels the same way.

import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";

import { clampPlotWindowPosition, MIN_PLOT_WINDOW_H, MIN_PLOT_WINDOW_W } from "../../windows/usePlotWindowGesture";
import { clampToolWindowPos, TITLE_BAR_HEIGHT, STATUS_BAR_HEIGHT } from "../../../lib/toolwindow";
import { pushEscapeSurface } from "../../../lib/escapeStack";
import type { Slot, WindowRef } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { dockRef, floatRef, plotIdOf } from "../../../store/windowLayoutActions";
import { dropZoneAt } from "./dropZones";
import { announce } from "./layoutAnnounce";

/** Pointer travel (px) before a press on a docked title bar becomes a drag. */
export const DRAG_THRESHOLD = 5;
const STYLE_WIDTH = 360;

export interface DragView {
  title: string;
  slot: Slot | null;
  /** The pointer, relative to the desk; the ghost label sits here. */
  x: number;
  y: number;
  /** A docked window shows a ghost label; a floating one is its own frame. */
  ghost: boolean;
}

let view: DragView | null = null;
const listeners = new Set<() => void>();
const setView = (v: DragView | null) => {
  view = v;
  listeners.forEach((l) => l());
};
/** The live drag, or null. */
export const useDragView = (): DragView | null =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => view,
  );

export interface DragOptions {
  ref: WindowRef;
  title: string;
  /** From a docked title bar (true) or a floating frame (false). */
  docked: boolean;
  start: { x: number; y: number; pointerId: number };
  /** Receives the pointer capture. */
  titleEl: Element | null;
  desk: HTMLElement;
  /** Put a floating frame back after Escape (the existing machinery commits its own move). */
  onCancel?: () => void;
}

let endActive: (() => void) | null = null;

/** Float a docked window so the pointer stays where it was on its title bar. */
function floatAtPointer(o: DragOptions, p: { x: number; y: number }, grab: { fx: number; dy: number }): void {
  const desk = o.desk.getBoundingClientRect();
  const s = useApp.getState();
  floatRef(o.ref);
  const id = plotIdOf(o.ref);
  if (id !== null) {
    const win = s.plotWindows.find((w) => w.id === id);
    if (!win) return;
    const w = Math.round(Math.max(MIN_PLOT_WINDOW_W, Math.min(win.geometry.w, desk.width * 0.8)));
    const h = Math.round(Math.max(MIN_PLOT_WINDOW_H, Math.min(win.geometry.h, desk.height * 0.8)));
    const at = clampPlotWindowPosition(Math.round(p.x - desk.left - grab.fx * w), Math.round(p.y - desk.top - grab.dy), desk);
    s.setWindowGeometry(id, { ...at, w, h });
    return;
  }
  const stored = s.toolWindowLayout[o.ref];
  const width = stored?.width ?? STYLE_WIDTH;
  const at = clampToolWindowPos(Math.round(p.x - grab.fx * width), Math.round(p.y - grab.dy), width, TITLE_BAR_HEIGHT, {
    width: window.innerWidth,
    height: window.innerHeight - STATUS_BAR_HEIGHT,
  });
  s.setToolWindowLayout(o.ref, { ...at, width, height: stored?.height ?? null, collapsed: false });
}

/** Start a title-bar drag; returns nothing, the session ends itself. */
export function beginLayoutDrag(o: DragOptions): void {
  endActive?.();
  const titleRect = o.titleEl?.getBoundingClientRect();
  const grab = { fx: titleRect && titleRect.width > 0 ? Math.min(1, Math.max(0, (o.start.x - titleRect.left) / titleRect.width)) : 0.5, dy: titleRect ? Math.min(40, Math.max(0, o.start.y - titleRect.top)) : 14 };
  const toolBefore = useApp.getState().toolWindowLayout[o.ref];
  let moved = false;
  let cancelled = false;
  try {
    o.titleEl?.setPointerCapture?.(o.start.pointerId);
  } catch {
    /* a synthetic or already released pointer: window listeners still end the drag */
  }
  const zoneAt = (e: PointerEvent) => {
    const r = o.desk.getBoundingClientRect();
    return e.altKey ? null : dropZoneAt({ x: e.clientX, y: e.clientY }, { x: r.left, y: r.top, w: r.width, h: r.height });
  };
  const onMove = (e: PointerEvent) => {
    if (cancelled) return e.stopPropagation(); // the frame must not keep following the pointer
    if (!moved && Math.hypot(e.clientX - o.start.x, e.clientY - o.start.y) < DRAG_THRESHOLD) return;
    moved = true;
    const r = o.desk.getBoundingClientRect();
    setView({ title: o.title, slot: zoneAt(e), x: e.clientX - r.left, y: e.clientY - r.top, ghost: o.docked });
  };
  const restoreTool = () => {
    if (o.docked || plotIdOf(o.ref) !== null) return;
    if (toolBefore) useApp.getState().setToolWindowLayout(o.ref, toolBefore);
    else useApp.setState((s) => ({ toolWindowLayout: Object.fromEntries(Object.entries(s.toolWindowLayout).filter(([k]) => k !== o.ref)) }));
  };
  const cleanup = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onLost, true);
    window.removeEventListener("blur", onLost);
    if (endActive === abort) endActive = null;
  };
  const offEscape = pushEscapeSurface("gesture", () => (cancel(true), true));
  /** End the gesture: `keepListening` (Escape, button still down) swallows
   *  the rest of the pointer's moves until release. */
  const cancel = (keepListening: boolean) => {
    if (cancelled) return;
    cancelled = true;
    setView(null);
    offEscape();
    if (!keepListening) cleanup();
    // The existing machinery has already written the move of a floating frame; undo it.
    if (!o.docked) {
      restoreTool();
      o.onCancel?.();
    }
    announce(`Move cancelled, ${o.title} stays where it was`);
  };
  const onLost = () => cancel(false);
  const abort = () => {
    cancelled = true;
    setView(null);
    offEscape();
    cleanup();
  };
  function onUp(e: PointerEvent): void {
    if (cancelled) return cleanup();
    const zone = moved ? zoneAt(e) : null;
    setView(null);
    offEscape();
    cleanup();
    if (!moved) return;
    if (zone) {
      e.stopPropagation(); // the frame's own gesture must not also commit its move
      dockRef(o.ref, zone);
      restoreTool();
    } else if (o.docked) floatAtPointer(o, { x: e.clientX, y: e.clientY }, grab);
  }
  endActive = abort;
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onLost, true);
  window.addEventListener("blur", onLost);
}

/** Begin a drag from a React pointerdown inside a window's title bar: a docked
 *  one (`e.currentTarget` is the title bar) or a floating frame (the plot
 *  window's or the tool window's own title bar, found from the target).
 *  Presses on a button, a field or a resize edge are not drags. */
export function dragFromPointerDown(e: ReactPointerEvent, o: Pick<DragOptions, "ref" | "title" | "docked" | "onCancel">): void {
  const target = e.target as Element;
  const desk = (e.currentTarget as Element).closest<HTMLElement>(".qzk-wl-desk");
  const titleEl = o.docked ? (e.currentTarget as Element) : target.closest(".qzk-plotwin-titlebar, .qzk-win-title");
  if (e.button !== 0 || !desk || !titleEl || target.closest("button, input, textarea, select, [data-resize-edge]")) return;
  beginLayoutDrag({ ...o, start: { x: e.clientX, y: e.clientY, pointerId: e.pointerId }, titleEl, desk });
}
