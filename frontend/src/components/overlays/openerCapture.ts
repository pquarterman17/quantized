// The opener-capture rule, as a dependency-free leaf. It used to live only in
// `useDialogFocus.ts`, which is a deliberate LAZY seam (architecture.test.ts's
// DRAGGED_OUT, bundle-diet slice 8): the eager `CommandPalette` needs the same
// rule (residual R2) and must not pull that module — or `lib/scrollOutFocus.ts`
// behind it — back into the entry chunk. `useDialogFocus` re-exports it, so
// every existing importer is untouched.

import { useRef, type RefObject } from "react";

// UX10-D (audit 10 P2-2): a dialog opened from a menu is mounted from a lazy
// chunk, so by the render that captures the opener the menu is gone and focus
// is already on <body>: the restore then had nowhere to go. This remembers the
// last element that took focus (a menu item carrying `qzMenuReturn`, a
// toolbar button...) so such an open can still name its opener. It is used
// only when focus is on <body> at that render, and only while fresh.
let lastFocus: { el: HTMLElement; at: number } | null = null;
const FRESH_MS = 5000;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    lastFocus = e.target instanceof HTMLElement ? { el: e.target, at: Date.now() } : null;
  }, true);
}

function recentFocus(): HTMLElement | null {
  return lastFocus && Date.now() - lastFocus.at < FRESH_MS ? lastFocus.el : null;
}

/** Remember, during the RENDER that opens a surface, where focus came from.
 *
 *  Render time, not effect time, and R12 turned that from a subtlety into a
 *  requirement: `useFocusTrap`'s layout effect makes the background `inert`
 *  before any passive effect runs, and HTML's focus-fixup rule lets an engine
 *  blur a focused element under a newly inert ancestor (Chromium 141 measured
 *  not to), so an effect-time read could remember <body>. It was already
 *  necessary before that, because by effect time an `autoFocus` field
 *  (ParamDialog's first row) or a surface's own focus-on-mount has run and the
 *  read would name a node INSIDE the surface — i.e. no restore at all.
 *
 *  The read is idempotent (nothing has moved focus yet), so a StrictMode
 *  double render sees the same answer, and the `wasOpen` latch makes it
 *  once-per-open either way. Shared with ConfirmDialog and CommandPalette,
 *  which keep their own restore rules but must capture the opener by exactly
 *  this rule. */
export function useOpenerCapture(open: boolean): RefObject<HTMLElement | null> {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) {
      const active = document.activeElement as HTMLElement | null;
      opener.current = !active || active === document.body ? (recentFocus() ?? active) : active;
    }
  }
  return opener;
}
