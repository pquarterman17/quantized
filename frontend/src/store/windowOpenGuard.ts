// Whether a whole-view Library open must go to a new window.
// Bundle diet (origin gap audit 3 #15's funding): moved verbatim out of
// store/windowUserEdits.ts, whose other exports run at startup; only lazy modules
// call this half, so it no longer ships in the startup chunk. Imported by
// path; store/windowUserEdits.ts does not re-export it.

import type { AppState } from "./useApp";
import { windowHasUserEdits } from "./windowUserEdits";
import { plotWindowDatasetId } from "./windowDocuments";

/** True when the focused plot window carries user edits AND shows none of
 *  `datasetIds` — a whole-view open (an Origin graph from the Library) should
 *  then go to a new window instead of replacing that work. Re-opening onto
 *  the window that already shows that data still refreshes it in place. */
export function focusedWindowGuardsAgainst(s: AppState, datasetIds: readonly string[]): boolean {
  const focused = s.plotWindows.find((w) => w.id === s.focusedWindowId);
  if (!focused || !windowHasUserEdits(s, focused)) return false;
  const shown = plotWindowDatasetId(focused);
  return shown === null || !datasetIds.includes(shown);
}
