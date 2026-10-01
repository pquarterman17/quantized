// LibraryTree.tsx's DOM-facing helpers (split out to keep the component under
// the .tsx ceiling): the key -> direction map, and how a DOM element maps to a
// row anchor, a row key, or a nested control that owns its own keystrokes.

import type { FlatLibraryNode } from "../../lib/libraryHierarchy";
import type { NavDirection } from "../../lib/libraryTreeNav";

export const NAV_KEYS: Record<string, NavDirection> = {
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowLeft: "left",
  Home: "home",
  End: "end",
};

/** The DOM selector for a row's own focusable anchor. Worksheets reuse
 *  DatasetRow's existing `data-ds-id`; every other kind carries the new
 *  uniform `data-lib-row`. */
export function rowSelector(row: FlatLibraryNode): string {
  if (row.node.kind === "worksheet") return `[data-ds-id="${CSS.escape(row.node.entityId)}"]`;
  return `[data-lib-row="${CSS.escape(row.node.key)}"]`;
}

/** The canonical key of the row a DOM element belongs to, or null when it
 *  isn't inside a row anchor at all (e.g. a click landed on the container
 *  background). */
export function keyOfRow(el: Element | null): string | null {
  const row = el?.closest("[data-lib-row], [data-ds-id]");
  if (!row) return null;
  const lib = row.getAttribute("data-lib-row");
  if (lib) return lib;
  const dsId = row.getAttribute("data-ds-id");
  return dsId ? `worksheet:${dsId}` : null;
}

/** P2 fix — keyboard hijack: true when `el` is a nested editable control
 *  (rename/tag input, the "⋯" menu button, the drag handle, …) or any other
 *  descendant that ISN'T the row's own anchor element itself. `keyOfRow`'s
 *  `.closest()` resolves ANY descendant (including a nested rename
 *  `<input>`) to its ancestor row, which is what let Enter in a rename
 *  input both commit AND open the row, and let arrow keys escape a text
 *  editor as roving-focus navigation. Only a keystroke whose target IS one
 *  of the row anchors is this container's to handle.
 *
 *  The anchor identity test runs FIRST and wins (P1 review fix): an
 *  ArtifactRow/FigureRow anchor was itself a `<button data-lib-row>` (a
 *  `<div>` in the tree since V1), so an element-kind test alone
 *  misclassified those anchors as nested controls —
 *  the container then ignored their arrows/Delete, which fell through to
 *  the GLOBAL dataset shortcuts and could remove an unrelated active
 *  worksheet. "Is the anchor" and "is interactive" are independent facts;
 *  only a non-anchor interactive descendant is someone else's keystroke. */
export function isEditorTarget(el: Element | null): boolean {
  if (!el) return true;
  if (el.hasAttribute("data-lib-row") || el.hasAttribute("data-ds-id")) return false;
  return true; // nested control or non-row target — never this container's
}

/** A genuine text-editing control, whose Delete/Backspace/arrows are native
 *  editing keys the container must never touch. Distinct from a nested
 *  BUTTON/drag-handle (retrospective-audit P1): those don't handle Delete or
 *  arrows at all, so an unconsumed keystroke on them bubbles to the global
 *  selection-based handlers and can remove or switch an UNRELATED dataset. */
export function isTextEditorTarget(el: Element): boolean {
  return el.matches("input, textarea, select, [contenteditable='true']");
}
