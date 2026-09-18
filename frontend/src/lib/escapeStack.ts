// The app's one ordered Escape registry. THE INVARIANT: the innermost open
// surface claims Escape, and the next Escape goes to the one below it.
//
// WHY IT EXISTS (P3.3 round 3, review findings 1+2). The P3.3 pass gave the
// workshop host (`ToolWindow`) its first keyboard dismissal and shielded it
// with `stopPropagation()`. Round 2 removed that shield — rightly, because it
// also killed every window-bubble Escape consumer in the app — and by doing so
// handed the key to two PRE-EXISTING listeners that `preventDefault()` on
// every Escape they see: `LibraryWorkspace` (Tiles) and
// `QuickFigureBuilderWorkspace`. Measured in real Chromium: with Tiles open
// and a workshop focused, Escape closed the WORKSPACE and left the workshop
// open — and the second Escape did nothing at all, because closing the
// workspace pulled focus out of the panel. The workshop became
// keyboard-undismissable, which is the exact feature the pass exists to add.
//
// Listener phase cannot express "innermost first". These surfaces are
// independent components with no common ancestor, they open in any order, and
// the one that should win is the one nearest the user — not the one that
// registered first. So they stop listening individually and register here.
//
// HOW IT DISPATCHES. One listener, on `window` in the BUBBLE phase, i.e. the
// very last stop on the propagation path. Everything that already owns Escape
// by stopping propagation keeps owning it, with no special case here: an open
// `ContextMenu` (document bubble), the `CommandPalette` (React synthetic),
// `ConfirmDialog` and the eight backdrop dialogs (window capture), a recipe
// row mid-rename. If the event reaches this listener at all, nothing upstream
// claimed it.
//
// The walk is then deferred ONE MACROTASK and re-reads `defaultPrevented`,
// which is a live property of the event. That is round 2's finding-2 fix, kept
// verbatim: a panel hook that claims the key with `preventDefault()` wins over
// its own window whatever order it registered in — `usePeakWizard` registers
// its listener when the wizard reaches step ②, long after the hosting window
// mounted, so registration order could never have fixed it. A microtask would
// not do: the spec runs a microtask checkpoint between listeners, so it can
// land mid-dispatch.
//
// ORDER. Layer first (a floating window is in front of the workspace behind
// it, whichever mounted first), then registration order within a layer. That
// second key is genuinely OPEN order, not push order: `useEscapeSurface`
// registers once per MOUNT and reads the handler through a ref, so a new
// callback identity — or a re-render — cannot reshuffle the stack. (This is
// the latent defect NIT 6 names in `useDialogFocus`'s trap stack, fixed there
// the same way.)

import { useEffect, useRef } from "react";

import { isEditingTarget } from "./editingTarget";
import { useApp } from "../store/useApp";

/** Which tier a surface sits in. `window` — a floating `ToolWindow`, in front
 *  of everything. `workspace` — a full-Stage workspace (Tiles, the Quick
 *  Figure Builder). `app` — the whole-app fallbacks that only get the key when
 *  no surface wanted it (`useGlobalShortcuts`' revert-the-armed-plot-tool). */
export type EscapeLayer = "app" | "workspace" | "window";

/** Return `true` to CLAIM the keystroke and stop the walk; `false` to decline
 *  and let the surface below have it. A `ToolWindow` declines when focus is
 *  not inside its own frame, which is how several open windows stay sane. */
export type EscapeHandler = (event: KeyboardEvent) => boolean;

const LAYER_RANK: Record<EscapeLayer, number> = { app: 0, workspace: 1, window: 2 };

type Entry = { layer: EscapeLayer; seq: number; handler: EscapeHandler };

const stack: Entry[] = [];
let nextSeq = 0;
/** One pending walk at a time (review finding 3). The previous shape was a
 *  single timer ref that each keydown OVERWROTE without clearing, so two
 *  Escapes armed two closes and a held Escape armed twelve. */
let pending: number | null = null;

function walk(event: KeyboardEvent): void {
  pending = null;
  if (event.defaultPrevented) return; // a consumer claimed it later in the dispatch
  const ordered = [...stack].sort(
    (a, b) => LAYER_RANK[a.layer] - LAYER_RANK[b.layer] || a.seq - b.seq,
  );
  for (let i = ordered.length - 1; i >= 0; i--) {
    const entry = ordered[i];
    // A handler above may have closed a surface below it; skip anything that
    // unregistered during this same walk.
    if (!stack.includes(entry)) continue;
    if (entry.handler(event)) return;
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  // An auto-repeating Escape is ONE intent, not one per repeat frame. Measured
  // on the round-2 tree: holding the key for a second called a workshop's
  // `onClose` twelve times, eleven of them after the panel had unmounted.
  // `ConfirmDialog` has had this guard from the start and documents why.
  if (event.repeat) return;
  // Escape inside a text field is the FIELD's, not a surface's — closing a
  // panel out from under someone mid-type discards what they were entering.
  if (isEditingTarget(event.target)) return;
  // The command palette owns its own Escape even if focus has drifted off its
  // input. Evaluated HERE, synchronously, not in the deferred walk: the
  // palette closes itself on the same keystroke, so by walk time the flag
  // would already read false.
  if (useApp.getState().cmdkOpen) return;
  // Belt and braces for GUI_INTERACTION #9 ("an open menu OWNS Escape").
  // `ContextMenu` stops propagation on document-bubble, so this listener is
  // normally not even reached; the check keeps the promise true for any menu
  // that forgets to.
  if (document.querySelector(".qzk-ctx")) return;
  if (stack.length === 0) return;
  if (pending !== null) clearTimeout(pending);
  pending = window.setTimeout(() => walk(event), 0);
}

/** Register a surface. Returns the unregister function (an effect cleanup). */
export function pushEscapeSurface(layer: EscapeLayer, handler: EscapeHandler): () => void {
  const entry: Entry = { layer, seq: nextSeq++, handler };
  stack.push(entry);
  if (stack.length === 1) window.addEventListener("keydown", onKeyDown);
  return () => {
    const at = stack.indexOf(entry);
    if (at !== -1) stack.splice(at, 1);
    if (stack.length === 0) {
      window.removeEventListener("keydown", onKeyDown);
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
    }
  };
}

/** Hook form. Registers once per mount while `enabled`, and always calls the
 *  LATEST `handler` — so a surface may close over fresh props without losing
 *  its place in the order. */
export function useEscapeSurface(layer: EscapeLayer, handler: EscapeHandler, enabled = true): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    return pushEscapeSurface(layer, (event) => latest.current(event));
  }, [layer, enabled]);
}
