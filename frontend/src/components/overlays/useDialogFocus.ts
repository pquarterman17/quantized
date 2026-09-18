// Shared keyboard-focus behaviour for the app's modal overlays (P3.3
// "keyboard reachability, focus, order, cancel"). Before this module every
// backdrop dialog hand-rolled its own answer, and the 2026-09-18 audit found
// the same three holes repeated across fifteen of them:
//
//  1. Nothing moved focus INTO the dialog. Several dialogs then put their
//     Escape handler on the dialog box's React `onKeyDown` — which only ever
//     fires when focus is already inside — so Escape was simply dead for
//     anyone who had not clicked a field first (ParamDialog with zero fields,
//     PlotRecipeApplyDialog, QuickPlotWithDialog).
//  2. Nothing trapped Tab. The backdrop blocks the POINTER, never the
//     keyboard, so Tab from the last control walked straight out of the modal
//     into the dimmed page behind it and kept going.
//  3. Nothing gave focus back on close, so dismissing any dialog dropped the
//     caller onto <body> — and `useGlobalShortcuts`' window-level
//     Delete/Backspace handler treats <body> as fair game.
//
// `ConfirmDialog` already solved (1) and (3) for itself, with reasoning and
// tests attached to the exact choices it makes (focus Cancel, not the
// destructive button; skip the restore when the confirmed action removed its
// own trigger). It is NOT rewritten onto this module — it only adopts
// `useFocusTrap` for the one thing it lacked.
//
// No new dependency: this is ~60 lines of DOM, not a focus-trap package.

import { useEffect, useRef, type RefObject } from "react";

// Deliberately NOT filtered by visibility/offsetParent. jsdom performs no
// layout, so every element reports zero size and `offsetParent === null`; a
// visibility filter would make this return an empty list under test while
// behaving differently in a browser, which is the worst of both. `hidden` and
// `aria-hidden` are attribute-level and do work in both, so those are checked.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Focusable descendants of `root`, in DOM order (which is Tab order here —
 *  no dialog in this app uses a positive `tabindex`). */
export function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
}

/** Keep Tab / Shift+Tab inside `ref` while `open`. Moves focus only when it
 *  would otherwise leave; an ordinary Tab between two controls is untouched.
 *
 *  Listens in the CAPTURE phase on `document` for two reasons: it must also
 *  catch a Tab pressed while focus has already leaked outside the dialog
 *  (pull it back rather than let it wander on), and no component in this app
 *  handles Tab itself except `useWindowCommands`' Ctrl+Tab, which this ignores
 *  because a plain `Tab` check excludes it. A `defaultPrevented` Tab is left
 *  alone regardless, so a future owner of the key still wins. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const root = ref.current;
      if (!root) return;
      const items = focusablesIn(root);
      // A dialog with nothing focusable still must not leak Tab to the page
      // behind it; park focus on the container (it carries tabIndex={-1}).
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [ref, open]);
}

/** The whole modal-dialog contract: trap Tab, move focus in on open, and give
 *  it back to the opener on close.
 *
 *  Focus-in is SKIPPED when focus is already inside `ref` — an `autoFocus`
 *  field (ParamDialog's first row) or a dialog's own more considered choice
 *  has already run by the time this effect fires, and overriding it would
 *  silently undo it. Otherwise the first focusable control is taken, falling
 *  back to the container itself (needs `tabIndex={-1}`) for a dialog that has
 *  none.
 *
 *  The restore is guarded by `isConnected`, matching ConfirmDialog: a dialog
 *  whose action removed its own trigger must not reach for a detached node. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useFocusTrap(ref, open);

  // The opener is read during the RENDER that opens the dialog, not in the
  // effect. By effect time the dialog is mounted and an `autoFocus` field
  // (ParamDialog's first row) has already taken focus, so an effect-time read
  // would remember a node INSIDE the dialog — and "restore" to something that
  // is about to be unmounted, i.e. no restore at all. At render time the DOM
  // still shows where the user actually was. The read is idempotent (nothing
  // has moved focus yet), so a StrictMode double-render sees the same answer,
  // and the `wasOpen` latch makes it once-per-open either way.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }

  useEffect(() => {
    if (!open) return;
    const cameFrom = opener.current;
    const root = ref.current;
    if (root && !(document.activeElement && root.contains(document.activeElement))) {
      (focusablesIn(root)[0] ?? root).focus();
    }
    return () => {
      // `isConnected` matches ConfirmDialog: a dialog whose action removed its
      // own trigger must not reach for a detached node.
      if (cameFrom?.isConnected) cameFrom.focus();
    };
  }, [ref, open]);
}
