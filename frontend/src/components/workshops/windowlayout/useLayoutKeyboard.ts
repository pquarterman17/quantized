// F6 / Shift+F6 cycle focus through the windows (WORKSPACE_LAYOUT_PLAN
// "Keyboard and accessibility", D13): Library, then the left stack (top to
// bottom), the centre (left to right), the right stack, the bottom (left to
// right) and the floating windows (back to front). Focus lands on the
// window's title bar (`focusTitleBar`); Tab enters it.
// F6 is free in the app's shortcut map; it is claimed only while windows mode
// is on (this hook lives in the lazy host) and, like every app shortcut, never
// under a modal dialog (lib/appShortcuts).

import { useEffect } from "react";

import { isModalOpen, listenForAppShortcuts } from "../../../lib/appShortcuts";
import { isEditingTarget } from "../../../lib/editingTarget";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { focusRef, isShown, plotIdOf } from "../../../store/windowLayoutActions";
import { closeFromChrome } from "./chromeActions";
import { cycleTarget, readingOrder } from "./layoutGeometry";

type Stop = WindowRef | "library";

const FRAME = "[data-wl-window], .qzk-plotwin, [data-tool-window]";

/** The window (or the Library) that holds `el`, if any. */
export function stopOf(el: Element | null): Stop | null {
  if (!el) return null;
  if (el.closest(".qzk-library")) return "library";
  const frame = el.closest(FRAME);
  const ref = frame?.querySelector("[data-wl-focus]")?.getAttribute("data-wl-focus");
  return (ref as WindowRef | undefined) ?? null;
}

const TITLE_BARS = ".qzk-wl-title, .qzk-plotwin-titlebar, .qzk-win-title";

/** Focus `ref`'s title bar (the plan's F6 target): a docked frame marks its own
 *  bar, a floating plot or tool window's dock-button group sits inside theirs.
 *  A bar that is not a tab stop yet becomes a programmatic one (tabindex -1). */
export function focusTitleBar(ref: WindowRef): boolean {
  const mark = document.querySelector<HTMLElement>(`[data-wl-focus="${CSS.escape(ref)}"]`);
  const bar = mark?.closest<HTMLElement>(TITLE_BARS) ?? mark;
  if (!bar) return false;
  if (!bar.hasAttribute("tabindex")) bar.tabIndex = -1;
  bar.focus();
  return true;
}

/** Focus `ref`'s title bar once it exists: a window that moves between slots is rebuilt (and a frame may
 *  still be loading), so try on the next frames, giving up after a second or so. */
export function focusTitleBarSoon(ref: WindowRef): void {
  let tries = 0;
  const go = () => {
    if (!focusTitleBar(ref) && ++tries < 60) requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}

function focusStop(stop: Stop): void {
  if (stop === "library") {
    const lib = document.querySelector<HTMLElement>(".qzk-library");
    lib?.querySelector<HTMLElement>('[tabindex="0"], input, button')?.focus();
    return;
  }
  focusRef(stop);
  focusTitleBar(stop);
}

export function useLayoutKeyboard(layout: WindowLayoutV1 | null, libraryShown: boolean): void {
  useEffect(() => {
    if (!layout) return;
    return listenForAppShortcuts((e) => {
      if (e.key !== "F6" || e.ctrlKey || e.metaKey || e.altKey) return;
      const order: Stop[] = [...(libraryShown ? (["library"] as const) : []), ...readingOrder(layout, (r) => isShown(layout, r))];
      const next = cycleTarget(order, stopOf(document.activeElement), e.shiftKey ? -1 : 1);
      if (!next) return;
      e.preventDefault();
      focusStop(next);
    });
  }, [layout, libraryShown]);
}

/** Ctrl/Cmd+Shift+W closes the window the keyboard is in. The Window menu's own handler closes the store's
 *  FOCUSED window, and a map (or worksheet) window is never that (a click only raises it), so from inside one
 *  the key did nothing (UX pass 4 m-5). In the capture phase, so that handler does not also close the plot
 *  that is focused behind it. From anywhere else it is untouched. */
export function useCloseWindowKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "w" || isModalOpen() || isEditingTarget(e.target)) return;
      const stop = stopOf(document.activeElement);
      const id = stop && stop !== "library" ? plotIdOf(stop) : null;
      const kind = id === null ? undefined : useApp.getState().plotWindows.find((w) => w.id === id)?.kind;
      if (!stop || stop === "library" || !kind || kind === "plot") return; // a plot is the focused window: the menu's handler closes it
      e.preventDefault();
      e.stopImmediatePropagation();
      closeFromChrome(stop);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
}
