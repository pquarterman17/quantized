// The Library editable-figure sibling of `sendFigureToReport`
// (commands/plotCommands.ts), moved out of the entry chunk (bundle diet slice
// 37, `plans/BUNDLE_HEADROOM.md`): only the Library's lazy context actions call it.

import type { StoreGet } from "../lib/exportActive";
import { onLoadFailure, runLazy } from "./fileCommands";

/** The Library editable-figure sibling of {@link sendFigureToReport} above
 *  (finding #9, P3.6 review round 2): the SAME `runLazy` + `.then(act,
 *  onLoadFailure)` shape, one chunk load, one failure toast — previously
 *  duplicated verbatim in `components/Library/artifactContextActions.ts`'s
 *  "Add to Report…" handler. Kept here, beside its plot-menu sibling, so the
 *  label/lazy-path/failure-handling live in exactly one place. */
export function sendEditableFigureToReport(s: StoreGet, figureId: string): Promise<void> {
  return runLazy("Loading report tools…", () => import("../lib/sendFigureToReport")).then(
    (m) => m.runSendEditableFigureToReport(s, figureId),
    onLoadFailure,
  );
}
