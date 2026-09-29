// The opener-capture rule, as a dependency-free leaf. It used to live only in
// `useDialogFocus.ts`, which is a deliberate LAZY seam (architecture.test.ts's
// DRAGGED_OUT, bundle-diet slice 8): the eager `CommandPalette` needs the same
// rule (residual R2) and must not pull that module — or `lib/scrollOutFocus.ts`
// behind it — back into the entry chunk. `useDialogFocus` re-exports it, so
// every existing importer is untouched.

import { useRef, type RefObject } from "react";

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
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }
  return opener;
}
