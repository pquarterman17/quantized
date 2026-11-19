// Shared plumbing for the two side-panel resize grips (Library, Inspector).
// pointerdown captures the starting width; window-level pointermove/pointerup
// listeners (attached only for the drag's duration) stream the clamped live
// width onto the panel's CSS custom property for a flicker-free resize, and
// release commits the final value through `commit` (the generic `setPref`,
// which persists to qz.prefs). `dir` is +1 when dragging right widens the
// panel (Library, on the left) and -1 when it narrows it (Inspector, right).

import { useEffect, useRef } from "react";

export const RESIZE_KEY_STEP = 16;

export interface PanelResizeSpec {
  /** CSS custom property streamed during a drag, e.g. "--lw". */
  cssVar: string;
  min: number;
  max: number;
  dir: 1 | -1;
  read: () => number;
  commit: (w: number) => void;
}

const clampTo = (s: PanelResizeSpec, px: number) => Math.min(s.max, Math.max(s.min, px));

/** Returns the pointerdown handler for a resize handle. */
export function usePanelResize(spec: PanelResizeSpec): (e: React.PointerEvent) => void {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup.current?.(); // a second pointerdown mid-drag restarts cleanly
    const startX = e.clientX;
    const startW = spec.read();
    let lastW = startW;
    const move = (ev: PointerEvent) => {
      lastW = clampTo(spec, startW + spec.dir * (ev.clientX - startX));
      document.documentElement.style.setProperty(spec.cssVar, `${lastW}px`);
    };
    const up = () => {
      cleanup.current?.();
      spec.commit(lastW);
    };
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
    // delivers pointerup — without these the drag stays armed (useColResize's
    // precedent, 2026-07-11 review finding).
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
  };
}

/** Keyboard + double-click for the separator: ArrowRight moves the edge right
 *  by 16 px (`dir` +1 widens the panel, -1 narrows it), ArrowLeft the reverse;
 *  double-click restores `reset`. */
export function panelResizeKeys(spec: PanelResizeSpec, reset: number) {
  return {
    onKeyDown(e: React.KeyboardEvent): void {
      const d = { ArrowRight: RESIZE_KEY_STEP, ArrowLeft: -RESIZE_KEY_STEP }[e.key as "ArrowLeft"];
      if (!d) return;
      e.preventDefault();
      spec.commit(clampTo(spec, spec.read() + spec.dir * d));
    },
    onDoubleClick(): void {
      spec.commit(reset);
    },
  };
}
