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

import { pushEscapeSurface } from "../../../lib/escapeStack";
import type { Slot, WindowRef } from "../../../lib/windowLayout/types";
import { dockRef, plotIdOf } from "../../../store/windowLayoutActions";
import { floatAtPointer, restoreToolLayout, toolLayoutOf } from "../../../store/windowLayoutMoves";
import { PLOT_LIMITS } from "./plotLimits";
import { dropZoneAt } from "./dropZoneHitTest";
import { announce } from "./layoutAnnounce";

/** Pointer travel (px) before a press on a docked title bar becomes a drag. */
export const DRAG_THRESHOLD = 5;

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

/** End a live drag without committing or restoring anything (the desk is
 *  going away: a mode switch must not leave window listeners, the Escape
 *  surface or a pending drop behind). */
export function abortLayoutDrag(): void {
  endActive?.();
}

/** Start a title-bar drag; returns nothing, the session ends itself. */
export function beginLayoutDrag(o: DragOptions): void {
  endActive?.();
  const titleRect = o.titleEl?.getBoundingClientRect();
  const grab = { fx: titleRect && titleRect.width > 0 ? Math.min(1, Math.max(0, (o.start.x - titleRect.left) / titleRect.width)) : 0.5, dy: titleRect ? Math.min(40, Math.max(0, o.start.y - titleRect.top)) : 14 };
  const toolBefore = toolLayoutOf(o.ref);
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
    restoreToolLayout(o.ref, toolBefore);
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
    } else if (o.docked) floatAtPointer(o.ref, o.desk.getBoundingClientRect(), { x: e.clientX, y: e.clientY }, grab, PLOT_LIMITS);
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
