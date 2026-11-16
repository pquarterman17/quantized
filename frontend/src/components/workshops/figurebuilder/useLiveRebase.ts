// UX-H review item 3: the export view must never export a stale snapshot.
// Now that Plot ▸ Export figure… opens this view, "change the plot, then
// export" is an everyday path. Whenever the plot drifts from the session's
// snapshot, re-base the session onto it if that loses nothing
// (store/publicationRebase.ts); otherwise `useFigureBuilder.canExport`
// disables Export and the view shows why.

import { useEffect, useMemo } from "react";

import { figurePublicationEdited } from "../../../store/figureUnsavedEdits";
import { rebaseFigurePublicationOnLive } from "../../../store/publicationRebase";
import { useApp } from "../../../store/useApp";

/** `stale`: `useFigureBuilder`'s own `exportStale` (one subscription). */
export function useLiveRebase(stale: boolean): void {
  // Also keyed on "has edits": undoing the preview's edits makes a rebase
  // lossless again, and it should then happen without another plot change.
  const session = useApp((s) => s.figurePublicationSession);
  const edited = useMemo(() => figurePublicationEdited(session), [session]);
  useEffect(() => {
    if (stale && !edited) rebaseFigurePublicationOnLive();
  }, [stale, edited]);
}
