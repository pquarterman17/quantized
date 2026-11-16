// UX-H review item 3: the export view must never export a stale snapshot.
// Now that Plot ▸ Export figure… opens this view, "change the plot, then
// export" is an everyday path. Whenever the plot drifts from the session's
// snapshot, re-base the session onto it if that loses nothing
// (store/publicationRebase.ts); otherwise `useFigureBuilder.canExport`
// disables Export and the view shows why.

import { useEffect } from "react";

import { selectSessionLiveDrifted } from "./canonicalSession";
import { rebaseFigurePublicationOnLive } from "../../../store/publicationRebase";
import { useApp } from "../../../store/useApp";

export function useLiveRebase(): void {
  const drifted = useApp(selectSessionLiveDrifted);
  useEffect(() => {
    if (drifted) rebaseFigurePublicationOnLive();
  }, [drifted]);
}
