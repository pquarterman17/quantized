// Session <-> live-store bridge for the Publication Preview drift check
// (item 1). Kept separate from canonicalOverrides.ts, which is deliberately
// pure with no store import -- this function genuinely needs
// `liveWindowDocument` (store/figureLifecycle.ts) and the full AppState, so
// it gets its own module instead of breaking that file's contract.

import type { PlotWindow } from "../../../lib/plotview";
// P3.3: the SAME call both canvas hooks make (`Stage/useStageSeriesCycle`),
// imported rather than restated — restating it is exactly how the focus gate
// below drifted from the canvas in the first place.
import { windowCyclesSeriesStyles } from "../../../lib/seriesStyleCycle";
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

/** P3.3 (`lib/seriesStyleCycle.ts`): does the Publication Preview's TARGET plot
 *  window cycle right now?
 *
 *  Only then may the preview image and its Export apply the auto dash/marker
 *  cycle, and then they MUST: the preview is the "what will I get" widget for
 *  that window's canvas, and that canvas's other export
 *  (`figureSpec.buildStageFigureSpec` — Copy figure / Export figure…) cycles the
 *  same positions. It drifted before this: one focused window with the
 *  preference on gave a dashed Stage canvas, a dashed Stage export, and a SOLID
 *  Figure Builder preview and Export — a third rendering of the same figure,
 *  which is exactly what MAIN #35's one-path invariant exists to prevent.
 *
 *  FOCUS IS NOT AN INPUT, and that was the second hole. This selector used to
 *  read `session.windowId === state.focusedWindowId`, while the canvas half
 *  (`Stage/useStageSeriesCycle.useWindowSeriesCycle`) never gated on focus at
 *  all: with Publication Preview open on w1 and w2 focused, w1's background
 *  canvas dashed while w1's preview and its Export rendered solid — the same
 *  divergence one layer over. The decision is now the very call the canvas hooks
 *  make — `seriesStyleCycle.windowCyclesSeriesStyles` — over the TARGET window's
 *  OWN document and view. The view is the LIVE singletons when that window holds
 *  focus, because that is what its canvas draws from and a window record's
 *  `view` copy lags them (the same focused/unfocused split
 *  `store/liveWindowDocument.ts` makes), and its own record otherwise.
 *
 *  Reading the LIVE view for a focused target also closes the drift the preview
 *  had against the window behind it: toggling polar/stat/stack/facet on that
 *  window stops its canvas cycling, and now stops the preview cycling in the
 *  same notification. (`selectSessionLiveDrifted` below still flags the whole
 *  draft as stale for that edit — the preview IMAGE renders the DRAFT document
 *  and does not re-derive the live view. That is a separate, already-reported
 *  condition, not a styling divergence.)
 *
 *  A `library` or `new-editable` session is a saved DOCUMENT with no live canvas
 *  beside it, so it stays uncycled — the same rule that keeps a Figure Page
 *  panel and a graph template uncycled, and what makes a saved document render
 *  identically however the preference is set. */
export function selectSessionCyclesSeriesStyles(state: AppState): boolean {
  const session = state.figurePublicationSession;
  // Cheap path first, for the same reason `selectSessionLiveDrifted` below has
  // one: this runs on every store notification, and the overwhelmingly common
  // case (preference off, or no open session) must not walk `plotWindows`. The
  // preference is then passed on rather than assumed, so the shared decision
  // still reads as the whole rule at its call site.
  if (!state.autoSeriesStyles || session === null || session.target !== "window") return false;
  const target = state.plotWindows.find((candidate) => candidate.id === session.windowId);
  if (target === undefined || target.kind !== "plot") return false;
  return windowCyclesSeriesStyles(
    state.autoSeriesStyles,
    target.id === state.focusedWindowId ? state : target.view,
    target.document,
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
