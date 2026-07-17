// GUI_INTERACTION #8: the pure index-arithmetic behind ContextMenu's keyboard
// navigation (ArrowUp/Down cycling, Home/End, type-ahead) — split out of
// ContextMenu.tsx (a .tsx component-ceiling ratchet, architecture.test.ts)
// so the DOM-heavy component stays thin and this algorithmic core is
// unit-testable without rendering anything. All three functions take the
// CURRENTLY FOCUSED item's index into `items` (or -1 for "nothing focused
// yet" — the menu's just-opened state) and return the next item index to
// focus, skipping separators/headers/swatches/disabled entries entirely (a
// disabled `<button disabled>` can't actually take DOM focus either, so
// including it here would just be a dead stop).

import type { ContextMenuItem } from "../components/overlays/ContextMenu";

/** Indices of every keyboard-focusable item (has a `label`, not disabled) —
 *  separators/headers/swatches/disabled entries are never a stop. */
export function focusableIndices(items: ContextMenuItem[]): number[] {
  return items.reduce<number[]>((acc, it, i) => {
    if ("label" in it && !it.disabled) acc.push(i);
    return acc;
  }, []);
}

/** The next focusable index in `dir` from `curIdx` (-1 = none focused yet),
 *  wrapping past either end. Null when the list has no focusable items. */
export function nextFocusableIndex(items: ContextMenuItem[], curIdx: number, dir: 1 | -1): number | null {
  const idxs = focusableIndices(items);
  if (!idxs.length) return null;
  const pos = idxs.indexOf(curIdx);
  const next = pos === -1 ? (dir === 1 ? 0 : idxs.length - 1) : (pos + dir + idxs.length) % idxs.length;
  return idxs[next];
}

/** The first/last focusable index (Home/End). */
export function edgeFocusableIndex(items: ContextMenuItem[], edge: "start" | "end"): number | null {
  const idxs = focusableIndices(items);
  if (!idxs.length) return null;
  return edge === "start" ? idxs[0] : idxs[idxs.length - 1];
}

/** Type-ahead: the next focusable item whose label starts with `ch`
 *  (case-insensitive). With nothing focused (`curIdx` -1) the scan starts AT
 *  the first item; with an item focused it starts AFTER it (wrapping, that
 *  item checked LAST) so repeated presses of the same letter cycle through
 *  every match instead of re-selecting the one already focused. */
export function typeaheadIndex(items: ContextMenuItem[], curIdx: number, ch: string): number | null {
  const idxs = focusableIndices(items);
  if (!idxs.length) return null;
  const pos = idxs.indexOf(curIdx);
  const base = pos === -1 ? 0 : pos + 1;
  const lower = ch.toLowerCase();
  for (let step = 0; step < idxs.length; step++) {
    const i = idxs[(base + step) % idxs.length];
    const it = items[i];
    if ("label" in it && it.label.toLowerCase().startsWith(lower)) return i;
  }
  return null;
}
