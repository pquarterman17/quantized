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
// No new dependency: this is ~100 lines of DOM, not a focus-trap package.

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { APP_ROOT_FOCUS_SELECTOR } from "../../lib/appRoot";
import { isTopModal, registerModal, releaseModal } from "../../lib/modalInert";
import { SCROLL_OUT_FOCUS_SELECTOR } from "../../lib/scrollOutFocus";

// Deliberately NOT filtered by visibility/offsetParent. jsdom performs no
// layout, so every element reports zero size and `offsetParent === null`; a
// visibility filter would make this return an empty list under test while
// behaving differently in a browser, which is the worst of both. `hidden` and
// `aria-hidden` are attribute-level and do work in both, so those are checked.
//
// Round 2 (review NIT 8): the first cut listed only the five classic form
// controls, so a `[contenteditable]` rich-text field, an embedded `iframe`, a
// `<summary>` disclosure or a media element with controls was invisible to
// the trap — Tab wrapped straight past it, and while the dialog was open that
// control could not be reached from the keyboard at all. No dialog fixed here
// renders one today; the selector is widened now rather than when R1 extends
// the trap to the eight remaining dialogs.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable]:not([contenteditable="false"])',
  "iframe",
  "summary",
  "audio[controls]",
  "video[controls]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** True when `el` — or anything between it and `root` — is hidden by
 *  attribute. Round 2 (review NIT 9): the first cut asked only the element
 *  itself, so a focusable inside an `aria-hidden` wrapper still counted as a
 *  Tab stop, which is exactly what that attribute exists to deny. The walk
 *  stops AT `root` and may not pass it: a dialog whose own chrome sits inside
 *  an `aria-hidden` region must still trap Tab among its controls rather than
 *  report having none.
 *
 *  Round 3 (review NIT 10): what this buys is precise — it moves the WRAP
 *  boundary, so Tab never lands on a hidden first/last control. It does not
 *  remove a hidden focusable from the natural tab order in between; the trap
 *  only intervenes at the two ends. Delivering the attribute's full meaning
 *  would need `inert`, which is a separate decision. */
function hiddenWithin(el: HTMLElement, root: HTMLElement): boolean {
  const stop = root.parentElement;
  for (let n: HTMLElement | null = el; n !== null && n !== stop; n = n.parentElement) {
    if (n.hasAttribute("hidden") || n.getAttribute("aria-hidden") === "true") return true;
  }
  return false;
}

/** Focusable descendants of `root`, in DOM order (which is Tab order here —
 *  no dialog in this app uses a positive `tabindex`). */
export function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !hiddenWithin(el, root));
}

/** Where focus goes when a surface closes and the element it was opened from
 *  is gone. NOT `<body>`: body focus is the documented data-loss path
 *  (`lib/focusGuard.ts` — `useGlobalShortcuts`' Delete/Backspace treats body
 *  as fair game), and it is a keyboard dead end besides.
 *
 *  First choice is the spot the Library's own focus-loss fallback already uses
 *  (`lib/scrollOutFocus.ts`): a `tabIndex={-1}` list container that catches
 *  orphaned focus and whose own keydown resumes arrow navigation from the
 *  roving item — a waypoint, not a dead end.
 *
 *  Round 3 (review finding 4): that container is rendered only by the three
 *  VIRTUALIZED Library renderers, so with zero rows — or while Details' search
 *  branch is behind its `Suspense` fallback — there was nothing to match and
 *  this silently did nothing, landing the user on `<body>` while the records
 *  promised otherwise. The shell root (`lib/appRoot.ts`) is the second choice
 *  and always exists in the real app.
 *
 *  LAST RESORT, documented rather than silent: in a harness that renders
 *  neither (a bare unit test, an embedded widget) nothing is focusable and the
 *  browser's own `<body>` fallback stands. */
function focusSafeLanding(): void {
  const landing =
    document.querySelector<HTMLElement>(SCROLL_OUT_FOCUS_SELECTOR)
    ?? document.querySelector<HTMLElement>(APP_ROOT_FOCUS_SELECTOR);
  landing?.focus();
}

/* WHICH TRAP ACTS. Round 2 (review finding 3): every open trap listens on
 * `document` in capture and pulls focus back whenever it is outside ITS OWN
 * root, so with two open they fought over every Tab and Tab was dead. Only
 * ONE trap may act: the active modal, which `lib/modalInert.ts` also keeps
 * live while it makes everything else `inert` — one answer for both, asked of
 * `isTopModal`, so the Tab trap and the inert background cannot disagree.
 *
 * "Active" is the dialog OPENED LAST, which `lib/escapeStack.ts` already
 * ranks Escape by and which modalInert also PAINTS on top (it stamps each open
 * backdrop's z-index in open order). Round 3 (NIT 6) had ordered by component
 * MOUNT order, and equal-z backdrops painted in TREE order; R12/R16 measured
 * both disagreeing with each other and with Escape in Chromium (2026-09-25):
 * Preferences, kept mounted after its first close, reopened over Help painted
 * on top but ranked below — inert and dead to the pointer — and `?` in Help
 * opened Shortcuts UNDERNEATH Help, where the first Escape closed it unseen.
 * One order — open order — now drives Escape, Tab, `inert` and paint. */

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
  // R12: while the trap is live the background is `inert`, walked from the
  // active (newest-opened, painted on top) open dialog.
  //
  // A LAYOUT effect, deliberately, for three orderings it buys:
  //  * It registers in the same commit that inserts the dialog, before
  //    `lib/modalInert.ts`'s MutationObserver can see that insertion — so a
  //    dialog mounting over another (a lazy body resolving over Preferences)
  //    is never judged as background by the previous dialog's walk, not
  //    even for a microtask (pinned by modalInertMutations.test.tsx).
  //  * On OPEN it runs before every passive effect, including the ones that
  //    move focus in. HTML's focus-fixup rule lets an engine blur a focused
  //    element once an ancestor is `inert` (Chromium 141 measured not to,
  //    yet), so every dialog remembers its opener during RENDER
  //    (`useOpenerCapture`), never in an effect.
  //  * On CLOSE it lifts `inert` before any passive cleanup restores focus;
  //    focusing into a still-inert background would silently do nothing.
  useLayoutEffect(() => {
    if (!open) return;
    registerModal(ref);
    return () => releaseModal(ref);
  }, [ref, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog stacked on top owns Tab (see WHICH TRAP ACTS above).
      if (!isTopModal(ref)) return;
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

/** Hand focus back from a closing surface. Exported through the hook below
 *  rather than directly, so both the unmount backstop and an eager call from
 *  a close handler go through the SAME rules.
 *
 *  Round 2 (review NIT 6): do not YANK focus. If the user has already moved
 *  on to a live control OUTSIDE the surface — a toast action, a field behind
 *  a non-modal panel — that is where they want to be, and the close is not
 *  what put them there. `<body>` (or nothing) is the opposite case: the DOM
 *  dropped focus as the surface unmounted, and this restore is all that
 *  stands between the user and a keyboard dead end. It also makes the eager
 *  and backstop calls idempotent: once focus is back on the opener, the
 *  second call sees a live control outside the surface and does nothing. */
function restoreFocusTo(cameFrom: HTMLElement | null, root: HTMLElement | null): void {
  const active = document.activeElement as HTMLElement | null;
  const dropped = active === null || active === document.body;
  if (!dropped && !(root && root.contains(active))) return;
  // `isConnected` matches ConfirmDialog: a surface whose action removed its
  // own trigger must not reach for a detached node — it lands on the shared
  // safe spot instead of being left on <body>.
  if (cameFrom?.isConnected) cameFrom.focus();
  else focusSafeLanding();
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
 *  once-per-open either way. Shared with ConfirmDialog, which keeps its own
 *  restore rules but must capture the opener by exactly this rule. */
export function useOpenerCapture(open: boolean): RefObject<HTMLElement | null> {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }
  return opener;
}

/** Remember where focus came FROM when `open` goes true, and give it back
 *  when the surface closes or unmounts. Shared by `useDialogFocus` and by
 *  `ToolWindow` (round 2, review finding 1: the workshop host started taking
 *  focus on mount and gave none back, so Escape-closing a panel left the user
 *  on `<body>` with the global Delete binding live).
 *
 *  Returns an EAGER restore for a close handler to call just before it tears
 *  the surface down. The unmount cleanup alone is not enough: React runs a
 *  deleted tree's passive destroy in a later flush, so between the DOM
 *  removal and that flush focus sits on `<body>` — exactly the window
 *  `useGlobalShortcuts`' Delete/Backspace binding is dangerous in. Measured in
 *  jsdom: after an Escape-close the panel was gone and `activeElement` was
 *  still `<body>`, with the cleanup not yet run. Moving focus first, inside
 *  the same handler that triggers the removal, is the pattern
 *  `lib/focusGuard.ts`'s `removeRowSafely` already documents — the browser's
 *  "focus reverts to body on unmount" never gets a turn. The cleanup stays as
 *  the backstop for every other way a surface can close.
 *
 *  The opener is read during the RENDER that opens the surface, not in the
 *  effect — `useOpenerCapture` above owns that rule and argues it out. */
export function useOpenerRestore(ref: RefObject<HTMLElement | null>, open: boolean): () => void {
  const opener = useOpenerCapture(open);

  useEffect(() => {
    if (!open) return;
    const cameFrom = opener.current;
    // `root` is captured at effect time because by cleanup time React has
    // already detached the ref.
    const root = ref.current;
    return () => restoreFocusTo(cameFrom, root);
    // `opener` is a ref, so its identity never changes; it is listed only
    // because the hook comes from `useOpenerCapture` and the exhaustive-deps
    // rule cannot see that.
  }, [ref, open, opener]);

  // R12: the eager call runs while the surface is still open, i.e. while the
  // background — the opener included — is still `inert`, where `focus()` is
  // refused. Releasing this surface's modal first is what lets the restore
  // land; the unmount cleanup's own release is then an idempotent resync.
  // For a non-modal surface (ToolWindow) it is a no-op resync.
  return useCallback(() => {
    releaseModal(ref);
    restoreFocusTo(opener.current, ref.current);
  }, [ref, opener]);
}

/** The whole modal-dialog contract: trap Tab, move focus in on open, and give
 *  it back to the opener on close.
 *
 *  Focus-in is SKIPPED when focus is already inside `ref` — an `autoFocus`
 *  field (ParamDialog's first row) or a dialog's own more considered choice
 *  has already run by the time this effect fires, and overriding it would
 *  silently undo it. Otherwise the first focusable control is taken, falling
 *  back to the container itself (needs `tabIndex={-1}`) for a dialog that has
 *  none. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean): () => void {
  useFocusTrap(ref, open);
  const restore = useOpenerRestore(ref, open);

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (root && !(document.activeElement && root.contains(document.activeElement))) {
      (focusablesIn(root)[0] ?? root).focus();
    }
  }, [ref, open]);
  return restore;
}
