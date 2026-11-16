// Roving tabindex for the plot dock (UX audit 8 #10, lane UX8-I): the dock's
// ~23 buttons used to be 23 Tab stops, so reaching the Inspector took ~49 Tabs.
// Now the dock is ONE Tab stop (the last-focused button, else the active tool,
// else the first enabled one) and Left/Right/Home/End move within it -- the
// WAI-ARIA toolbar pattern.
//
// DOM-driven on purpose: the buttons are rendered by several components
// (ToolButton, the Annotate split button, the "..." options button) and the
// overflow logic mounts/hides whole groups, so one effect after every render
// re-stamps `tabindex` over whatever is currently reachable. React never sets
// `tabIndex` on these buttons, so nothing fights the stamp. Buttons in a
// collapsed overflow group (`[data-overflow]`) and disabled ones are skipped.

import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

function reachable(bar: HTMLElement): HTMLButtonElement[] {
  return Array.from(bar.querySelectorAll<HTMLButtonElement>("button.qzk-tool-btn:not([disabled])")).filter((b) => !b.closest("[data-overflow]"));
}

export function useRovingToolbar(barRef: RefObject<HTMLElement | null>): {
  onKeyDown: (e: KeyboardEvent) => void;
  onFocus: (e: FocusEvent) => void;
} {
  const stopRef = useRef<HTMLElement | null>(null);

  const stamp = (): void => {
    const bar = barRef.current;
    if (!bar) return;
    const all = reachable(bar);
    if (all.length === 0) return;
    const keep =
      all.find((b) => b === stopRef.current) ?? all.find((b) => b.getAttribute("aria-pressed") === "true") ?? all[0];
    stopRef.current = keep;
    for (const b of Array.from(bar.querySelectorAll<HTMLButtonElement>("button.qzk-tool-btn"))) b.tabIndex = b === keep ? 0 : -1;
  };
  // Every render (tool picks, overflow changes, disabled flips) may change the set.
  useEffect(stamp);

  return {
    onFocus: (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>("button.qzk-tool-btn");
      if (!t || t.disabled || t.closest("[data-overflow]")) return;
      stopRef.current = t;
      stamp();
    },
    onKeyDown: (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const bar = barRef.current;
      const from = (e.target as HTMLElement).closest<HTMLButtonElement>("button.qzk-tool-btn");
      if (!bar || !from) return;
      const all = reachable(bar);
      const i = all.indexOf(from);
      if (i < 0) return;
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % all.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + all.length) % all.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = all.length - 1;
      if (next < 0) return;
      e.preventDefault();
      all[next].focus();
    },
  };
}
