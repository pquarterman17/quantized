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

/** P3.3 (`lib/seriesStyleCycle.ts`): does the Publication Preview currently
 *  render the FOCUSED plot window's own figure?
 *
 *  Only then may its preview and its Export apply the auto dash/marker cycle,
 *  and then they MUST: the preview is the "what will I get" widget for the very
 *  canvas behind the dialog, and that canvas's other export
 *  (`figureSpec.buildStageFigureSpec` — Copy figure / Export figure…) cycles. It
 *  drifted before this: one focused window with the preference on gave a dashed
 *  Stage canvas, a dashed Stage export, and a SOLID Figure Builder preview and
 *  Export — a third rendering of the same figure, which is exactly what
 *  MAIN #35's one-path invariant exists to prevent.
 *
 *  A `library` or `new-editable` session is a saved DOCUMENT with no live canvas
 *  beside it, so it stays uncycled — the same rule that keeps a Figure Page
 *  panel and a graph template uncycled, and what makes a saved document render
 *  identically however the preference is set. The `window`-target test is the
 *  same one `targetBlocked` makes: a session whose window lost focus is no
 *  longer previewing what the Stage draws. The exact-publication-styles refusal
 *  is not repeated here — `buildFigureSpecForView` ships such an array verbatim
 *  and never calls `buildExportStyles`, so the cycle cannot reach it. */
export function selectSessionCyclesSeriesStyles(state: AppState): boolean {
  const session = state.figurePublicationSession;
  return (
    state.autoSeriesStyles &&
    session !== null &&
    session.target === "window" &&
    session.windowId === state.focusedWindowId
  );
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
