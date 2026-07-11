// Column-header edge drag-resize (MAIN_PLAN #3). The handle's pointerdown
// captures the starting width; window-level pointermove/pointerup listeners
// (attached only for the drag's duration, removed on release — the same
// transient-listener pattern useWorksheetView's Esc handler uses) stream the
// clamped live width through `onResizeCol`. Width state itself lives in
// useWorksheetView (session-transient, per key decision 6 / MAIN_PLAN's
// "widths are SESSION state only" scope); this hook is just the pointer
// plumbing, so GridHeader stays presentational.

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { clampColWidth } from "../../../lib/gridwindow";

export interface ColResizeApi {
  /** Start dragging column `col`'s right edge. Call from the handle's
   *  onPointerDown — stops propagation so the header's select-click never
   *  sees the gesture. */
  startResize: (col: number, e: ReactPointerEvent) => void;
}

export function useColResize(
  widthOf: (col: number) => number,
  onResizeCol: (col: number, width: number) => void,
): ColResizeApi {
  // Live listeners survive re-renders via refs; cleanup on unmount guards a
  // drag interrupted by the component going away.
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const startResize = (col: number, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup.current?.(); // a second pointerdown mid-drag restarts cleanly
    const startX = e.clientX;
    const startW = widthOf(col);
    const move = (ev: PointerEvent) => {
      onResizeCol(col, clampColWidth(startW + (ev.clientX - startX)));
    };
    const up = () => cleanup.current?.();
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // Releasing outside the browser window (or an OS pen/touch cancel) never
    // delivers pointerup - without these the drag stays armed and the column
    // keeps resizing on re-entry with no button held (review 2026-07-11).
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
  };

  return { startResize };
}
