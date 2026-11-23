// F6 / Shift+F6 cycle focus through the windows (WORKSPACE_LAYOUT_PLAN
// "Keyboard and accessibility", D13): Library, then the left stack (top to
// bottom), the centre (left to right), the right stack, the bottom (left to
// right) and the floating windows (back to front). Focus lands on the
// window's title bar (its dock-button group, `data-wl-focus`); Tab enters it.
// F6 is free in the app's shortcut map; it is claimed only while windows mode
// is on (this hook lives in the lazy host) and, like every app shortcut, never
// under a modal dialog (lib/appShortcuts).

import { useEffect } from "react";

import { listenForAppShortcuts } from "../../../lib/appShortcuts";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { focusRef, isShown } from "../../../store/windowLayoutActions";
import { cycleTarget, readingOrder } from "./layoutGeometry";

type Stop = WindowRef | "library";

const FRAME = "[data-wl-window], .qzk-plotwin, [data-tool-window]";

/** The window (or the Library) that holds `el`, if any. */
function stopOf(el: Element | null): Stop | null {
  if (!el) return null;
  if (el.closest(".qzk-library")) return "library";
  const frame = el.closest(FRAME);
  const ref = frame?.querySelector("[data-wl-focus]")?.getAttribute("data-wl-focus");
  return (ref as WindowRef | undefined) ?? null;
}

function focusStop(stop: Stop): void {
  if (stop === "library") {
    const lib = document.querySelector<HTMLElement>(".qzk-library");
    lib?.querySelector<HTMLElement>('[tabindex="0"], input, button')?.focus();
    return;
  }
  focusRef(stop);
  document.querySelector<HTMLElement>(`[data-wl-focus="${CSS.escape(stop)}"]`)?.focus();
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
