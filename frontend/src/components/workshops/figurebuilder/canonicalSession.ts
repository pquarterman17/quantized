// Session <-> live-store bridge for the Publication Preview drift check
// (item 1). Kept separate from canonicalOverrides.ts, which is deliberately
// pure with no store import -- this function genuinely needs
// `liveWindowDocument` (store/figureLifecycle.ts) and the full AppState, so
// it gets its own module instead of breaking that file's contract.

import type { PlotWindow } from "../../../lib/plotview";
import { liveWindowDocument, type FigurePublicationSession } from "../../../store/figureLifecycle";
import type { AppState } from "../../../store/useApp";

/** True once a window-target session's live document -- the SAME comparison
 *  `applyFigurePublicationEdit` makes against `session.baseline` -- has
 *  already drifted, so the caller can flag Apply as blocked BEFORE the user
 *  clicks it instead of only after a rejected Apply flips `staleBaseline`.
 *  Skips the comparison entirely once a session is absent, detached
 *  (`new-editable` has no window to drift from), already flagged
 *  `staleBaseline`, or its target window is blocked for another reason --
 *  those paths already carry their own Apply-blocking reason. */
export function sessionLiveDrifted(
  session: FigurePublicationSession,
  plotWindows: readonly PlotWindow[],
  targetBlocked: boolean,
  state: AppState,
): boolean {
  if (session.target === "new-editable" || session.staleBaseline || targetBlocked) return false;
  const window = plotWindows.find((candidate) => candidate.id === session.windowId);
  if (!window) return false;
  const live = liveWindowDocument(state, window);
  return live !== null && JSON.stringify(live) !== JSON.stringify(session.baseline);
}
