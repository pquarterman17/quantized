// Session <-> live-store bridge for the Publication Preview drift check
// (item 1). Kept separate from canonicalOverrides.ts, which is deliberately
// pure with no store import -- this function genuinely needs
// `liveWindowDocument` (store/figureLifecycle.ts) and the full AppState, so
// it gets its own module instead of breaking that file's contract.

import type { PlotWindow } from "../../../lib/plotview";
import { liveWindowDocument, type FigurePublicationSession } from "../../../store/figureLifecycle";
import { libraryWindowLiveDrifted } from "../../../store/figurePublicationLibrary";
import type { AppState } from "../../../store/useApp";

/** True once a session's live document -- the SAME comparison
 *  `applyFigurePublicationEdit` makes against `session.baseline` -- has
 *  already drifted, so the caller can flag Apply as blocked BEFORE the user
 *  clicks it instead of only after a rejected Apply flips `staleBaseline`.
 *  Skips the comparison entirely once a session is absent, detached
 *  (`new-editable` has no window to drift from), already flagged
 *  `staleBaseline`, or (window target only) its target window is blocked for
 *  another reason -- those paths already carry their own Apply-blocking
 *  reason.
 *
 *  Item 1: the `library` target has no single "target window" to be
 *  blocked on -- ANY open window sharing its document id counts, focused or
 *  not -- so it delegates to `libraryWindowLiveDrifted`
 *  (figurePublicationLibrary.ts), the exact check `resolveLibraryApply`
 *  enforces at Apply time, instead of the single-`windowId` comparison below
 *  that only ever fits the `window` target. */
export function sessionLiveDrifted(
  session: FigurePublicationSession,
  plotWindows: readonly PlotWindow[],
  targetBlocked: boolean,
  state: AppState,
): boolean {
  if (session.staleBaseline) return false;
  if (session.target === "library") return libraryWindowLiveDrifted(state, session);
  if (session.target === "new-editable" || targetBlocked) return false;
  const window = plotWindows.find((candidate) => candidate.id === session.windowId);
  if (!window) return false;
  const live = liveWindowDocument(state, window);
  return live !== null && JSON.stringify(live) !== JSON.stringify(session.baseline);
}

/** Zustand SELECTOR form of the check above -- the form `useFigureBuilder`
 *  must use.
 *
 *  The distinction is not stylistic. A focused window's LIVE document is
 *  derived (`liveWindowDocument` -> `snapshotView`) from the top-level store
 *  singletons -- `refLines`, `regionShades`, `shapes`, `annotations`,
 *  `hiddenChannels`, `plotTitle`, every `VIEW_KEYS` field -- NOT from the
 *  window record. Reading them through `useApp.getState()` at render time
 *  computes the right answer but subscribes to nothing, so a Stage edit made
 *  behind the open, non-modal preview never woke the hook: Apply stayed
 *  enabled, and clicking it rejected the whole session
 *  ("publication preview target changed; changes not applied"), discarding
 *  every preview edit. That is the precise failure item 1 exists to prevent,
 *  and it survived item 1 because the item-1 test drifts `plotWindows` -- a
 *  field the hook DOES subscribe to.
 *
 *  Cost: this runs on every store notification, so the no-session case (the
 *  overwhelming majority of the app's life -- Publication Preview is one
 *  transient tool window) short-circuits on a single property read before
 *  touching `plotWindows` or building any document. Only an open,
 *  not-yet-stale, window-target session pays for the derive+stringify, and
 *  it returns a BOOLEAN, so an unchanged answer re-renders nothing. */
export function selectSessionLiveDrifted(state: AppState): boolean {
  const session = state.figurePublicationSession;
  if (session === null || session.target === "new-editable" || session.staleBaseline) return false;
  // Mirrors useFigureBuilder's own `targetBlocked` exactly; both mean "this
  // session has a different Apply-blocking reason already" -- and, like that
  // one, only means anything for the `window` target. A `library` session's
  // `windowId` is always null (no single target window), so evaluating this
  // against `session.windowId` unconditionally used to read as "blocked" for
  // EVERY library session regardless of real window state, which is exactly
  // what silenced item 1 for that target: `sessionLiveDrifted` never got past
  // its `targetBlocked` guard to run the check at all.
  const targetBlocked = session.target === "window" && (
    !state.plotWindows.some((candidate) => candidate.id === session.windowId) ||
    state.focusedWindowId !== session.windowId
  );
  return sessionLiveDrifted(session, state.plotWindows, targetBlocked, state);
}
