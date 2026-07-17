// Cross-plugin escape hatch for the uPlot gesture plugins (GUI_INTERACTION
// #9, universal cancel). A drag's LIVE state lives in a mousedown-scoped
// closure inside a plugin's `ready` hook (uplotTools/uplotRegionTools/
// uplotGadgets) — invisible to React/the store, and torn down only by the
// plugin's own `mouseup` listener. There is no other way to reach in from
// outside and abort it.
//
// Each plugin registers a `cancel()` here the instant a drag begins (right
// alongside its own `document.addEventListener("mousemove"/"mouseup", …)`
// calls) and clears the registration in its own `mouseup` handler. `cancel()`
// itself removes those same listeners and discards the live state WITHOUT
// committing a result — a true abort, not an early commit.
//
// Two outside triggers call `cancelActiveGesture()`: the global Escape
// handler (useGlobalShortcuts — cancelling wins over "revert tool to
// Pointer", so the first Esc during a drag only aborts the drag) and
// PlotStage's right-click handler (useStageContextMenu — a half-drawn
// region must not survive under an opened context menu).
//
// Scope note: uPlot's OWN native rubber-band drag (the "zoom" tool's
// box-zoom and the "select"/"region" tools' x-band select, driven by
// `cursor.drag` + `hooks.setSelect`) is not wired through this registry —
// uPlot binds and tears down its own document listeners internally with no
// public "abort this drag" API, so there is nothing safe to hook without
// patching uPlot's cursor internals. Escape still does the right thing for
// those tools (nothing is registered, so `cancelActiveGesture` is a no-op
// and the "no gesture in progress" branch reverts the tool to Pointer).

let activeCancel: (() => void) | null = null;

/** Register the canceller for the drag currently in progress, or clear it
 *  with `null` on release/teardown. Only one gesture can be live at a time
 *  (uPlot's own `cursor.drag` serializes mousedown handling across tools —
 *  and a single plugin instance only ever runs one drag branch at once), so
 *  a fresh registration simply replaces whatever was there. */
export function setActiveGestureCancel(cancel: (() => void) | null): void {
  activeCancel = cancel;
}

/** Cancel the in-progress drag, if any — removes its listeners and discards
 *  its live state without committing. Returns true when something was
 *  actually cancelled, so callers can decide what to do on a "nothing to
 *  cancel" Escape (e.g. fall through to reverting the tool to Pointer). */
export function cancelActiveGesture(): boolean {
  if (!activeCancel) return false;
  const cancel = activeCancel;
  activeCancel = null;
  cancel();
  return true;
}
