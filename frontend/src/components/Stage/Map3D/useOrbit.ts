// The interactive 3-D view's gestures: drag to rotate, wheel to zoom, arrow
// keys to rotate (Shift = 15°) and +/- to zoom, 0 / Home to reset. The view
// moves LOCALLY while a gesture runs (no store write per pixel, unrounded so
// small trackpad steps add up) and is committed ONCE, rounded, when it ends --
// pointer up, or 400 ms after the last wheel notch / key press -- so one
// gesture is one undo step and the export reads the angles the screen settled
// on. A pending commit is FLUSHED as soon as the pointer or focus leaves the
// plot (so ⤓ clicked right after a key press exports the new view) and on
// unmount; a stored-view change from elsewhere (undo, the panel's fields)
// while one is pending wins and cancels it -- except the global Undo / Redo
// KEYS, which flush the pending gesture first (a capture-phase listener runs
// before the app's shortcut), so Ctrl+Z undoes that gesture as one step
// instead of discarding it. During a DRAG the stored view is not followed
// (the drag owns the camera until release); an undo then lands on release's
// commit as the next step. `moving` is true during a gesture
// and briefly after, which the renderer uses to draw the decimated scene.

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
  const storedRef = useRef(stored);
  storedRef.current = stored;

  const commitNow = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    const v = clampView(live.current);
    live.current = v;
    setView(v);
    if (!same(v, storedRef.current)) commitRef.current(v);
  }, []);

  // The stored view moved (undo, the panel's angle fields, a loaded project):
  // follow it -- dropping a pending commit, which it supersedes -- unless the
  // user is mid-drag.
  useEffect(() => {
    if (drag.current) return;
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    if (!same(live.current, stored)) {
      live.current = stored;
      setView(stored);
    }
  }, [stored]);

  // Ctrl/Cmd+Z, Ctrl+Y, Ctrl+Shift+Z anywhere: commit the pending gesture
  // first, so the undo it triggers undoes THAT gesture as one step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key) && commitTimer.current) commitNow();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [commitNow]);

  // Unmounting (e.g. switching to "Export preview") keeps the gesture.
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (commitTimer.current) commitNow();
  }, [commitNow]);

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

  const commitSoon = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commitNow, COMMIT_IDLE_MS);
  }, [commitNow]);

  /** Commit a pending wheel / key gesture now (pointer or focus left). */
  const flush = useCallback(() => {
    if (commitTimer.current) commitNow();
  }, [commitNow]);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setMoving(false);
    commitNow();
  }, [commitNow]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    flush();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [flush]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>): boolean => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return false;
    // The button was released where no pointerup reached us: the drag is over.
    if ((e.buttons & 1) === 0) {
      endDrag();
      return false;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (dx === 0 && dy === 0) return true;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    move(orbit(live.current, dx, dy));
    return true;
  }, [move, endDrag]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    endDrag();
  }, [endDrag]);

  const onWheel = useCallback((deltaY: number) => {
    move(zoomBy(live.current, deltaY));
    commitSoon();
  }, [move, commitSoon]);

  const resetView = useCallback(() => {
    live.current = clampView(reset);
    commitNow();
  }, [commitNow, reset]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "0" || e.key === "Home") {
      e.preventDefault();
      resetView();
      return;
    }
    const next = keyStep(live.current, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    move(next);
    commitSoon();
  }, [move, commitSoon, resetView]);

  return { view, moving, onPointerDown, onPointerMove, onPointerUp, onLostPointerCapture: endDrag, onWheel, onKeyDown, resetView, flush };
}
