// Pure decision logic for the `library` Publication Preview target (edit a
// SAVED editable figure directly, Apply replaces that Library entry in
// place). Kept out of figureLifecycle.ts -- already near its 500-line module
// ceiling -- as a module with no figureLifecycle.ts dependency (the
// previewDrag.ts / canonicalSession.ts pattern): this module only DECIDES the
// outcome; figureLifecycle.ts's applyFigurePublicationEdit performs the side
// effects (recordHistory, toast, set). It DOES import liveWindowDocument (item
// 1) -- from the dependency-free store/liveWindowDocument.ts, never from
// figureLifecycle.ts itself, which is what would recreate the cycle this
// module's split exists to avoid (figureLifecycle.ts already imports
// resolveLibraryApply FROM here).

import type { FigureDocument } from "../lib/figureDocument";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";
import type { FigurePublicationSession } from "./figureLifecycle";
import { liveWindowDocument } from "./liveWindowDocument";

/** Why `document` currently can't render in Publication Preview -- a missing
 *  live dataset or a missing frozen snapshot -- or null once it's ready.
 *  Shared by every entry point that opens or applies a document OUTSIDE a
 *  live window (a focused window's own liveness is a different question,
 *  answered by applyFigurePublicationEdit's window branch instead): the
 *  detached-draft begin/apply pair, the Library-entry begin/apply pair, and
 *  the Library row button's disabled-state tooltip -- one rule, not copies. */
export function figurePublicationSourceUnavailable(
  document: FigureDocument,
  datasets: readonly Dataset[],
): string | null {
  if (
    document.data.mode === "live" &&
    (!document.bindings.datasetId || !datasets.some((dataset) => dataset.id === document.bindings.datasetId))
  ) return "source dataset is unavailable";
  if (document.data.mode === "frozen" && !document.data.snapshot) return "frozen data is unavailable";
  return null;
}

export type LibraryApplyOutcome =
  | { kind: "stale"; toastMsg: string }
  | { kind: "unavailable"; msg: string }
  | { kind: "ready"; document: FigureDocument; syncFocusedView: boolean };

/** True once ANY open window sharing `session.draft`'s document id -- focused
 *  or not, the same population the Apply branch below syncs -- has drifted
 *  live from `session.baseline`. Item 1 (data loss): a saved figure open as a
 *  live window with an unsaved Stage edit (a drawn shape, a log-scale toggle)
 *  never touches `state.editableFigures`, so the plain "did the saved entry
 *  change" check below sees nothing wrong -- Apply used to sail through and
 *  `applyFigurePublicationEdit`'s library branch would unconditionally
 *  `withPlotWindowDocument` that window (and `hydrateView` it too, if
 *  focused), silently reverting the live edit. Exported so
 *  canonicalSession.ts's `sessionLiveDrifted` -- the SAME proactive
 *  per-render check the window target already gets, so Apply disables itself
 *  and the banner explains why BEFORE the user clicks it, not only after a
 *  rejected Apply -- can call this instead of duplicating it;
 *  `resolveLibraryApply` below is what actually enforces it at Apply time. */
export function libraryWindowLiveDrifted(state: AppState, session: FigurePublicationSession): boolean {
  return state.plotWindows.some((window) => {
    if (window.kind !== "plot" || window.document?.id !== session.draft.id) return false;
    const live = liveWindowDocument(state, window);
    return live !== null && JSON.stringify(live) !== JSON.stringify(session.baseline);
  });
}

/** Resolve a `library`-target session's Apply. Refuses (`stale`, the same
 *  Cancel-and-reopen recovery as the window target) if the saved figure was
 *  deleted or edited elsewhere (renamed, re-saved from an open window sharing
 *  its id) since the session began, OR (item 1) if an open window sharing its
 *  id has since live-drifted on Stage without ever being saved; refuses
 *  (`unavailable`) if its data source is no longer resolvable; otherwise
 *  reports whether a FOCUSED plot window also carries this same document by
 *  id. When it does, the caller must ALSO hydrate the live top-level view
 *  singletons: a focused window's document is rebuilt FROM those singletons
 *  on every `liveWindowDocument` read (see its doc comment), so writing only
 *  `window.document` would be silently overwritten by the very next such
 *  read -- the identical reason the window-target Apply branch hydrates. */
export function resolveLibraryApply(state: AppState, session: FigurePublicationSession): LibraryApplyOutcome {
  const document = session.draft;
  const saved = state.editableFigures.find((candidate) => candidate.id === document.id);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(session.baseline)) {
    return {
      kind: "stale",
      toastMsg: saved
        ? "the saved figure changed while previewing — Cancel and reopen Publication Preview to pick up the changes"
        : "the saved figure was deleted while previewing — Cancel to close this preview",
    };
  }
  if (libraryWindowLiveDrifted(state, session)) {
    return {
      kind: "stale",
      // Same vocabulary the window target's own live-drift refusal uses
      // (figureLifecycle.ts's applyFigurePublicationEdit / useFigureBuilder.ts's
      // applyBlockedReason) -- one phrase for "a live Stage edit, not a saved
      // change elsewhere", covering both targets.
      toastMsg: "the plot changed while previewing — Cancel and reopen Publication Preview to pick up the changes",
    };
  }
  const problem = figurePublicationSourceUnavailable(document, state.datasets);
  if (problem) return { kind: "unavailable", msg: `cannot apply changes to "${document.name}": ${problem}` };
  const syncFocusedView = state.plotWindows.some((candidate) =>
    candidate.kind === "plot" && candidate.document?.id === document.id && candidate.id === state.focusedWindowId,
  );
  return { kind: "ready", document, syncFocusedView };
}
