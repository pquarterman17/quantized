// Library panel drag-resize (GUI_INTERACTION_PLAN #13 sub-item 5). Mirrors
// Stage/worksheet/useColResize.ts's pointer-plumbing pattern: pointerdown
// captures the starting width, window-level pointermove/pointerup listeners
// (attached only for the drag's duration) stream the clamped live width
// straight onto the --lw custom property for a flicker-free resize, and
// pointerup commits the final value to the store (`setPref`, the SAME
// generic pref setter every other appearance/behaviour pref uses) — which
// persists it to qz.prefs via syncPrefs.

import { useEffect, useRef } from "react";

import {
  LIBRARY_PANEL_WIDTH_DEFAULT,
  LIBRARY_PANEL_WIDTH_MAX,
  LIBRARY_PANEL_WIDTH_MIN,
} from "../../store/prefs";
import { useApp } from "../../store/useApp";

const setWidth = (w: number) => useApp.getState().setPref("libraryPanelWidth", w);

function clamp(px: number): number {
  return Math.min(LIBRARY_PANEL_WIDTH_MAX, Math.max(LIBRARY_PANEL_WIDTH_MIN, px));
}

/** Returns the pointerdown handler for the resize handle. */
export function useLibraryResize(): (e: React.PointerEvent) => void {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup.current?.(); // a second pointerdown mid-drag restarts cleanly
    const startX = e.clientX;
    const startW = useApp.getState().libraryPanelWidth;
    let lastW = startW;
    const move = (ev: PointerEvent) => {
      lastW = clamp(startW + (ev.clientX - startX));
      document.documentElement.style.setProperty("--lw", `${lastW}px`);
    };
    const up = () => {
      cleanup.current?.();
      setWidth(lastW);
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

/** Keyboard + double-click for the separator: Left/Right step 16 px,
 *  double-click restores the first-run default width. */
export const libraryResizeKeys = {
  onKeyDown(e: React.KeyboardEvent): void {
    const d = { ArrowRight: 16, ArrowLeft: -16 }[e.key as "ArrowLeft"];
    if (!d) return;
    e.preventDefault();
    setWidth(clamp(useApp.getState().libraryPanelWidth + d));
  },
  onDoubleClick(): void {
    setWidth(LIBRARY_PANEL_WIDTH_DEFAULT);
  },
};
