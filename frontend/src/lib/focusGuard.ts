import type { KeyboardEvent } from "react";

// Shared focus-safety helpers for the plot "decor" cards/panels — region
// shades, shapes, reference lines, annotations, error-column bindings — both
// the Stage's Inspector cards and their Publication Preview panel
// equivalents. Every one of them renders a per-row remove (✕) button that
// unmounts its OWN row on click.
//
// Left alone, the instant that button's DOM node disappears the browser
// drops focus to <body> (nothing else claims it), and
// `useGlobalShortcuts.ts`'s Delete/Backspace handler exempts only editing
// targets (input/textarea/select/contentEditable) and `defaultPrevented` —
// body is neither. Reproduced live: Inspector "Region shades" card -> add a
// shade -> click its ✕ -> press Delete -> status "removed 1 dataset", every
// dataset gone. The SAME click-✕-then-Delete pattern exists on every sibling
// card/panel in this class (data-loss, not cosmetic), so the fix belongs at
// the class, not one card.
//
// TWO parts, both required — moving focus alone is NOT enough (measured
// live: focus lands on the container, but the dataset still disappeared,
// because a focused plain <div> is not an "editing target" either, so
// useGlobalShortcuts' `!isEditing(e.target)` guard still lets the keystroke
// through):
//
//  1. `removeRowSafely` moves focus to a stable container BEFORE the row
//     disappears, inside the SAME synchronous click handler that triggers
//     the removal. Because focus assignment is synchronous, the browser's
//     own "focus reverts to <body> on unmount" behavior never gets a turn.
//  2. `absorbStrayDeleteOnContainer`, wired as that same container's
//     `onKeyDown`, calls `preventDefault()` on a Delete/Backspace that
//     targets the container ITSELF (not a nested field, which stays exempt
//     via `isEditing` as normal). `useGlobalShortcuts` is a WINDOW listener,
//     so it fires on the way out of every element handler; `preventDefault()`
//     anywhere earlier in the same bubble phase — including here — sets
//     `defaultPrevented` before the event ever reaches it. This is the exact
//     mechanism the module doc there already documents for "a component that
//     deletes its OWN focused object" (the map ROI box, the worksheet's
//     selected block, a Figure Page slot); a post-removal focus anchor is
//     just one more such component, its "own selection" being empty.
//
// `container` needs `tabIndex={-1}` so `.focus()` is legal (it stays out of
// the normal Tab order — a safety-net landing spot, not a new stop). Neither
// helper touches useGlobalShortcuts' global Delete semantics — Delete-on-body
// still removes the active dataset, which is the intended Library flow.
export function removeRowSafely(container: HTMLElement | null, remove: () => void): void {
  container?.focus();
  remove();
}

export function absorbStrayDeleteOnContainer(e: KeyboardEvent<HTMLElement>): void {
  if (e.target === e.currentTarget && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
  }
}
