// The app's one ordered Escape registry. THE INVARIANT: the innermost open
// surface claims Escape, one Escape performs ONE action, and the next Escape
// goes to the surface below it.
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
// ROUND 4 (review of round 3, findings 2+3). Round 3 moved only ONE of
// `useGlobalShortcuts`' three Escape tiers in here; the other two kept
// claiming the key inline, ahead of every registered surface, so the invariant
// above was false as written. Measured: with Tiles open over a COMMITTED
// quick-fit ROI, Escape destroyed the ROI and left Tiles open. Every remaining
// consumer now has a layer — the live-gesture cancel, the Stage's four
// deselect listeners, the two Shell menus — so "innermost claims it, exactly
// once" is a property of one ordered walk instead of of listener phase.
//
// THE TWO DOCUMENTED EXCEPTIONS. Both claim by `preventDefault()` before this
// dispatcher runs, and both are correct there:
//  - `SymbolPalette` — a popover opened FROM a text field, which has to keep
//    owning Escape while focus is still IN that field. `isEditingTarget`
//    below deliberately gives that state to the field, so the palette cannot
//    be expressed as a surface here.
//  - `usePeakWizard`'s marker-edit pause — a window-bubble claim from inside
//    its own `ToolWindow`, mounted only while there is something to pause.
// Each is conditional on its own surface being present, so neither can swallow
// an Escape that nothing wanted. Residual R11 records the focus gap in the
// second.
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
// verbatim: a consumer that claims the key with `preventDefault()` wins over
// the whole stack whatever order it registered in — `usePeakWizard` registers
// its listener when the wizard reaches step ②, long after the hosting window
// mounted, so registration order could never have fixed it. A microtask would
// not do: the spec runs a microtask checkpoint between listeners, so it can
// land mid-dispatch. That deferred re-read is now the ONLY `defaultPrevented`
// gate (review NIT 10): the synchronous copy could fire only for a
// document-bubble claimant, which the re-read catches too — along with every
// claim that lands after the keydown, which the synchronous copy could not see.
//
// ORDER. Layer first, then registration order within a layer. That second key
// is genuinely OPEN order, not push order: `useEscapeSurface` registers once
// per MOUNT and reads the handler through a ref, so a new callback identity —
// or a re-render — cannot reshuffle the stack. (This is the latent defect
// NIT 6 names in `useDialogFocus`'s trap stack, fixed there the same way.)
//
// ROUND 5. WHEN the ladder is resolved, not just in what order. Round 4 chose
// the acting surface inside the deferred walk, one macrotask after the key was
// pressed, so a surface could lose its claim in the gap and the key fell
// THROUGH it to a lower layer — one keystroke, two actions, the class rounds
// 2–4 kept re-creating. Measured in Chromium on `region-tool-escape`
// (deviceScaleFactor 1.25 and 2.0, ~1 run in 2): Escape at t=1628.9 ms with a
// live Integrate drag, the queued `mouseup` dispatched at t=1632.3 ms —
// Chromium runs a pending input task ahead of a 0 ms timer — and the walk only
// at t=1657.3 ms, 25 ms late. By then `uplotRegionTools`' own `mouseup` had
// torn the drag down and COMMITTED a region, so the `gesture` surface declined
// and the walk ran on to the `app` tier, which disarmed the tool. The user
// pressed Escape and got a committed result plus a disarmed tool.
//
// So the CLAIM is resolved when the key is pressed; only the ACTION waits:
//  - `onKeyDown` snapshots the ordered stack, and the walk runs that snapshot
//    rather than re-reading `stack`. A surface that goes away between the
//    keydown and the walk was the innermost one at the moment of the
//    keystroke, so the walk STOPS there instead of handing its key down the
//    ladder (`liveAtWalk` below). Dying DURING the walk still only skips that
//    entry — round 4's finding-4 rule, which exists for a handler that closes
//    a surface beneath it, and is a different moment in time.
//  - the `gesture` layer cannot be deferred at all, because waiting is what
//    destroys it: see `RESOLVES_AT_KEYDOWN`.

import { useEffect, useRef } from "react";

import { isEditingTarget } from "./editingTarget";
import { useApp } from "../store/useApp";

/** Which tier a surface sits in, outermost first.
 *
 *  `app` — the whole-app fallbacks that only get the key when nothing else
 *  wanted it (`useGlobalShortcuts`' revert-the-armed-plot-tool).
 *  `selection` — a live selection or an armed-but-idle gadget ON the Stage: a
 *  selected shape/annotation, an active draw mode, a worksheet column
 *  selection, a committed quick-fit ROI. Below any open surface (round 4,
 *  review finding 3: an idle gadget behind a focused window is not innermost)
 *  and above the app fallbacks, because clearing a selection is a smaller
 *  undo than disarming the tool that made it.
 *  `workspace` — a full-Stage workspace (Tiles, the Quick Figure Builder).
 *  `window` — a floating `ToolWindow`, in front of the workspace behind it.
 *  `gesture` — a drag that is happening RIGHT NOW. Genuinely the innermost
 *  thing on screen: the user's hand is on it, and cancelling it must beat
 *  every surface, including the window focus happens to be in. It is also the
 *  one layer whose claim cannot survive the deferral, so it is resolved
 *  synchronously — see `RESOLVES_AT_KEYDOWN`.
 *  `menu` — an open menu owns Escape (GUI_INTERACTION #9). */
export type EscapeLayer = "app" | "selection" | "workspace" | "window" | "gesture" | "menu";

/** Return `true` to CLAIM the keystroke and stop the walk; `false` to decline
 *  and let the surface below have it. A `ToolWindow` declines when focus is
 *  not inside its own frame, which is how several open windows stay sane. */
export type EscapeHandler = (event: KeyboardEvent) => boolean;

const LAYER_RANK: Record<EscapeLayer, number> = {
  app: 0,
  selection: 1,
  workspace: 2,
  window: 3,
  gesture: 4,
  menu: 5,
};

/** The one layer whose handler runs SYNCHRONOUSLY, in the keydown listener,
 *  instead of in the deferred walk (round 5).
 *
 *  A live drag is not merely stale by walk time — it is GONE, and it took its
 *  result with it. Measured: the queued `mouseup` beat the 0 ms timer by 25 ms,
 *  the plugin's own release handler committed a region and cleared the
 *  canceller, and the walk then found nothing to cancel. Cancelling a drag
 *  means removing the listeners that would commit it, so it has to happen
 *  before the browser can deliver that release: there is no "resolve now, act
 *  later" for this layer.
 *
 *  Acting here means this layer does not see a `preventDefault()` that lands
 *  after the dispatcher — which costs nothing, because it is the top of the
 *  ladder bar `menu`: nothing below it may outrank it anyway, and a claim that
 *  arrived BEFORE the dispatcher (window-capture, document-bubble — how
 *  `SymbolPalette` claims) is already visible in `defaultPrevented` and still
 *  wins. A `menu` open above a drag suspends the synchronous path entirely
 *  (see `onKeyDown`), so "an open menu owns Escape" is unchanged. */
const RESOLVES_AT_KEYDOWN: EscapeLayer = "gesture";

type Entry = { layer: EscapeLayer; seq: number; handler: EscapeHandler };

const stack: Entry[] = [];
let nextSeq = 0;
/** One pending walk at a time (review finding 3). The previous shape was a
 *  single timer ref that each keydown OVERWROTE without clearing, so two
 *  Escapes armed two closes and a held Escape armed twelve. */
let pending: number | null = null;
/** The ordered stack AS IT STOOD when the pending keystroke was pressed
 *  (round 5). The walk runs this, not a fresh read of `stack`, so nothing that
 *  happens in the gap can change which surfaces are in the running. */
let pendingOrder: Entry[] = [];

/** The stack innermost-first: the order Escape is offered in. */
function orderInnermostFirst(): Entry[] {
  return [...stack].sort(
    (a, b) => LAYER_RANK[b.layer] - LAYER_RANK[a.layer] || b.seq - a.seq,
  );
}

/** Run one surface's handler. Returns true if it CLAIMED the keystroke.
 *
 *  A handler that throws must not eat the key for everything beneath it
 *  (review NIT 5): without this, one broken surface made Escape dead for the
 *  whole app for as long as it stayed mounted, and the exception escaped the
 *  `setTimeout` outside any React error boundary. Treated as a decline, so the
 *  surface below still gets its turn. */
function offer(entry: Entry, event: KeyboardEvent): boolean {
  try {
    return entry.handler(event);
  } catch (error) {
    console.error("escapeStack: a surface handler threw; continuing the walk", error);
    return false;
  }
}

function walk(event: KeyboardEvent): void {
  const ordered = pendingOrder;
  pending = null;
  pendingOrder = [];
  if (event.defaultPrevented) return; // a consumer claimed it during the dispatch
  // Which of the snapshot's surfaces made it to the walk. Read ONCE, here, so
  // the two ways an entry can go stale stay distinguishable below.
  const liveAtWalk = new Set(stack);
  for (const entry of ordered) {
    // Gone between the keydown and this walk (round 5). This surface was the
    // innermost one when the key was pressed — whatever removed it in the gap
    // took the keystroke with it, and handing the key to a LOWER layer now
    // would perform an action the user aimed at something else. Stop.
    if (!liveAtWalk.has(entry)) return;
    // Gone DURING this walk: a handler above closed a surface below it
    // (round 4, finding 4). Skip the dead entry and carry on — the walk that
    // is already running is what removed it.
    if (!stack.includes(entry)) continue;
    if (offer(entry, event)) return;
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
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
  // that forgets to. The Shell's own menus are `menu`-layer surfaces instead.
  if (document.querySelector(".qzk-ctx")) return;
  if (stack.length === 0) return;

  const ordered = orderInnermostFirst();
  // Resolve the layer that cannot wait, NOW, inside the keydown listener.
  // Only surfaces ABOVE the first non-synchronous one can be offered the key
  // here: a `menu` outranks a drag, and asking a menu synchronously would
  // defeat the deferral that the two documented `preventDefault()` claimants
  // rely on. So the scan stops at the first entry that is not
  // `RESOLVES_AT_KEYDOWN`, and everything from there down goes to the walk.
  let rest = 0;
  if (!event.defaultPrevented) {
    while (rest < ordered.length && ordered[rest].layer === RESOLVES_AT_KEYDOWN) {
      const entry = ordered[rest];
      rest++;
      if (!offer(entry, event)) continue; // nothing live: the layer declines
      // Claimed and already acted on. Nothing below may run for this key, and
      // a walk armed by an earlier keystroke in this same tick is void.
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
        pendingOrder = [];
      }
      return;
    }
  }
  const snapshot = ordered.slice(rest);
  if (snapshot.length === 0) return;

  if (pending !== null) clearTimeout(pending);
  pendingOrder = snapshot;
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
        pendingOrder = [];
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
