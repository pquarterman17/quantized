// Preferences search, inside the open pane (PREFS_AUDIT P2-15): hide every row
// whose label and hint do not contain the query. Works on the rendered rows
// (`.qzk-pref-row`) so every row kind is covered (PrefRow and the hand-built
// rows of BootstrapCapPref, WindowLayoutPref, ...) with no per-row wiring; a
// MutationObserver re-applies it when a pane adds a row (the window-layout
// rows appear only while windows mode is on). Notes hide while searching.
// The tab strip itself narrows by the registry's keywords (prefsTabs.tsx).

import { useLayoutEffect } from "react";

function apply(pane: HTMLElement, q: string, showAll: boolean): void {
  const rows = [...pane.querySelectorAll<HTMLElement>(".qzk-pref-row")];
  const hit = rows.map((row) => {
    const text = row.querySelector(".qzk-pref-lbl")?.textContent ?? row.textContent ?? "";
    return text.toLowerCase().includes(q);
  });
  // A tab found only by a synonym keyword (no row text matches): show it whole.
  const all = showAll || !hit.some(Boolean);
  rows.forEach((row, i) => (row.hidden = !all && !hit[i]));
  for (const note of pane.querySelectorAll<HTMLElement>(".qzk-pref-note")) note.hidden = !all;
}

/** `q` is the normalised query; `showAll` when the query names the tab itself. */
export function usePrefsSearch(pane: HTMLElement | null, q: string, showAll: boolean, renderKey: string): void {
  useLayoutEffect(() => {
    if (!pane) return;
    apply(pane, q, showAll || q === "");
    if (q === "") return;
    const mo = new MutationObserver(() => apply(pane, q, showAll));
    mo.observe(pane, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [pane, q, showAll, renderKey]);
}
