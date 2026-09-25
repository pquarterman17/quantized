// The app's keyboard-shortcut gate: which window-level app shortcuts may act
// while a modal dialog is open (PRIMARY_SOFTWARE_AUDIT_PLAN P3.3, residual R15).
//
// WHAT WAS WRONG. `inert` (lib/modalInert.ts, R12) takes the background out of
// focus, the pointer and the accessibility tree, but a `window` keydown
// listener sees every key pressed ANYWHERE, a dialog's own buttons included.
// So with Preferences open and focus on one of its buttons, Delete removed the
// active dataset, Ctrl+Z undid an edit, `f` opened the curve-fit window, the
// arrows stepped the plotted dataset and Ctrl+K opened the palette: the key
// acted on an app the user could not see or reach.
//
// THE RULE, while any modal is open:
//  * a shortcut that acts on the BACKGROUND app does nothing: undo/redo,
//    Delete, the tool and navigation keys, the palette, open/paste/save, the
//    panel and theme toggles, and the window commands (Ctrl+Tab,
//    Ctrl+Shift+N/D/W);
//  * the two shortcuts that open ANOTHER DIALOG ON TOP still work: `?`
//    (Shortcuts) and Ctrl/Cmd+, (Preferences). R16 made that layering
//    deliberate and correct: the dialog opened last is the one painted on top,
//    the one Escape closes and the one Tab stays in, and closing it hands the
//    dialog beneath its focus back. Nothing behind the dialogs changes;
//  * keys inside the dialog are untouched. The gate only decides whether an
//    APP handler runs; it never calls `preventDefault()` or stops propagation,
//    so a text field keeps its native Ctrl+Z, paste and typing, and a
//    dialog's own handlers (React `onKeyDown`, Escape via lib/escapeStack.ts,
//    the Tab trap) run exactly as before.
//
// WHAT COUNTS AS OPEN. A hold per modal: `lib/modalInert.ts` takes one for
// every registered dialog (the same set the background `inert` is walked
// for), and `usePendingDialogGuard` takes one while a lazy dialog body is
// asked but still loading (bundle-diet slice 8), when nothing is modal on
// screen yet but the ask already owns the keyboard.
//
// WHY ITS OWN MODULE. The shortcut hooks are eager; `modalInert.ts` ships in
// `useDialogFocus`'s lazy chunk and must stay there (bundle pin). This file is
// the small eager seam both sides import.

const holds = new Set<object>();

/** Take (`on`) or drop a modal hold keyed by `key`. Idempotent both ways. */
export function holdModal(key: object, on: boolean): void {
  if (on) holds.add(key);
  else holds.delete(key);
}

/** Is any modal dialog open (or a lazy one pending)? */
export function isModalOpen(): boolean {
  return holds.size > 0;
}

/** The shortcuts that open a dialog ON TOP of an open one (see THE RULE). */
function layersOverModal(e: KeyboardEvent): boolean {
  return e.key === "?" || ((e.metaKey || e.ctrlKey) && e.key === ",");
}

/** Listen on `window` for app shortcuts, through the gate. Every app-level
 *  shortcut handler registers here rather than on `window` directly, so the
 *  rule above lives in this one place. Returns the unlisten function. */
export function listenForAppShortcuts(handler: (e: KeyboardEvent) => void): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (holds.size === 0 || layersOverModal(e)) handler(e);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
