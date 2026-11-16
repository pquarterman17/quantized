// The interactive 3-D view's gestures: drag to rotate, wheel to zoom, arrow
// keys to rotate (Shift = 15°) and +/- to zoom, 0 / Home to reset. The view
// moves LOCALLY while a gesture runs (no store write per pixel) and is
// committed ONCE when it ends -- pointer up, or 400 ms after the last wheel
// notch / key press -- so one gesture is one undo step and the export reads
// the angles the screen settled on. `moving` is true during a gesture and
// briefly after, which the renderer uses to draw the decimated scene.

import { useCallback, useEffect, useRef, useState } from "react";

import { clampView, keyStep, orbit, zoomBy, type View3d } from "../../../lib/project3d";

export const COMMIT_IDLE_MS = 400;
/** The scene is drawn decimated until the view has been still this long. */
export const SETTLE_MS = 160;

const same = (a: View3d, b: View3d) => a.elev === b.elev && a.azim === b.azim && a.zoom === b.zoom;

export function useOrbit(stored: View3d, onCommit: (v: View3d) => void, reset: View3d) {
  const [view, setView] = useState<View3d>(stored);
  const [moving, setMoving] = useState(false);
  const live = useRef(view);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // The stored view moved (undo, the panel's angle fields, a loaded project):
  // follow it, unless the user is mid-gesture.
  useEffect(() => {
    if (drag.current || commitTimer.current) return;
    if (!same(live.current, stored)) {
      live.current = stored;
      setView(stored);
    }
  }, [stored]);

  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const move = useCallback((v: View3d) => {
    live.current = v;
    setView(v);
    setMoving(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      if (!drag.current) setMoving(false);
    }, SETTLE_MS);
  }, []);

  const commitNow = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    commitRef.current(live.current);
  }, []);

  const commitSoon = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commitNow, COMMIT_IDLE_MS);
  }, [commitNow]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>): boolean => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return false;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (dx === 0 && dy === 0) return true;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    move(orbit(live.current, dx, dy));
    return true;
  }, [move]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setMoving(false);
    if (!same(live.current, stored)) commitNow();
  }, [commitNow, stored]);

  const onWheel = useCallback((deltaY: number) => {
    move(zoomBy(live.current, deltaY));
    commitSoon();
  }, [move, commitSoon]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "0" || e.key === "Home") {
      e.preventDefault();
      live.current = clampView(reset);
      setView(live.current);
      commitNow();
      return;
    }
    const next = keyStep(live.current, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    move(next);
    commitSoon();
  }, [move, commitSoon, commitNow, reset]);

  const resetView = useCallback(() => {
    live.current = clampView(reset);
    setView(live.current);
    commitNow();
  }, [commitNow, reset]);

  return { view, moving, onPointerDown, onPointerMove, onPointerUp, onWheel, onKeyDown, resetView };
}
