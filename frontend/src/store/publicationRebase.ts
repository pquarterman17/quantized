// UX-H review item 3: re-base an open Publication preview session onto the
// live plot when that is lossless. Store-side (not in the view hook that
// triggers it, components/workshops/figurebuilder/useLiveRebase.ts) because
// it needs the whole store to derive the window's live document.
//
// A window-target session snapshots the plot when it opens. When the plot
// changes behind the view and the draft holds no figure edits of its own
// (only output choices: format / preset / DPI), the session simply follows
// the live plot, keeping those output choices. With real preview edits there
// is no safe merge, so nothing changes here and Export stays disabled with
// the reason (useFigureBuilder.canExport).

import { figurePublicationEdited } from "./figureUnsavedEdits";
import { liveWindowDocument } from "./liveWindowDocument";
import { useApp } from "./useApp";

export function rebaseFigurePublicationOnLive(): void {
  const state = useApp.getState();
  const session = state.figurePublicationSession;
  if (!session || session.target !== "window" || figurePublicationEdited(session)) return;
  const window = state.plotWindows.find((candidate) => candidate.id === session.windowId);
  const live = window ? liveWindowDocument(state, window) : null;
  if (!live) return;
  const { format, stylePreset, dpi } = session.draft.output;
  useApp.setState({
    figurePublicationSession: {
      ...session,
      baseline: structuredClone(live),
      draft: { ...structuredClone(live), output: { ...live.output, format, stylePreset, dpi } },
      exported: undefined,
      staleBaseline: undefined, // a fresh baseline: Apply works again
    },
  });
}
