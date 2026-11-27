// The on-demand half of the editable FigureDocument lifecycle (bundle diet
// slice 36): the Publication Preview session actions (begin, apply), the
// legacy-figure promotion and the Library figure actions (save as, open,
// rename, duplicate, delete). Only lazy surfaces call them (the Publication
// Preview view, the Library's figure sections, the Figure Page and Graph
// Builder workshops, the export command), so the eager slice keeps one proxy
// per action (store/figureLifecycleLazy.ts) and these bodies, with the
// figure-conversion and library-apply helpers they alone use, load on demand.
// Moved verbatim from store/figureLifecycle.ts.
import { figureDocumentToPlotView, type FigureDocument } from "../lib/figureDocument";
import { figureDocumentFromLegacyFigureDoc } from "../lib/figureDocumentPublication";
import { hydrateView } from "../lib/plotview";
import { SESSION_BUSY_MSG, nextFigureId, type FigureLifecycleSlice } from "./figureLifecycle";
import { figurePublicationSourceUnavailable, resolveLibraryApply } from "./figurePublicationLibrary";
import { liveWindowDocument } from "./liveWindowDocument";
import { toast } from "./toasts";
import { editableFigureByteEstimate } from "./trash";
import type { AppState } from "./useApp";
import { withPlotWindowDocument } from "./windowDocuments";

type SliceSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export type FigureLifecycleRun = Pick<
  FigureLifecycleSlice,
  | "beginFigurePublicationEdit"
  | "beginDetachedFigurePublicationEdit"
  | "beginFigurePublicationEditForFigure"
  | "applyFigurePublicationEdit"
  | "promoteLegacyFigureDoc"
  | "saveFigureAs"
  | "openEditableFigure"
  | "renameEditableFigure"
  | "duplicateEditableFigure"
  | "deleteEditableFigure"
>;

export function createFigureLifecycleRun(set: SliceSet, get: SliceGet): FigureLifecycleRun {
  return {
    beginFigurePublicationEdit: (requestedWindowId) => {
      const state = get();
      if (state.figurePublicationSession) {
        toast(SESSION_BUSY_MSG, "danger");
        set({ status: SESSION_BUSY_MSG });
        return false;
      }
      const windowId = requestedWindowId ?? state.focusedWindowId;
      const window = windowId ? state.plotWindows.find((candidate) => candidate.id === windowId) : undefined;
      const document = window && liveWindowDocument(state, window);
      if (!window || !document || window.id !== state.focusedWindowId) return false;
      set({
        figurePublicationSession: {
          target: "window",
          windowId: window.id,
          baseline: structuredClone(document),
          draft: structuredClone(document),
        },
        figureBuilderOpen: true,
      });
      return true;
    },
    beginDetachedFigurePublicationEdit: (document) => {
      const state = get();
      if (state.figurePublicationSession) {
        toast(SESSION_BUSY_MSG, "danger");
        set({ status: SESSION_BUSY_MSG });
        return false;
      }
      const problem = figurePublicationSourceUnavailable(document, state.datasets);
      if (problem) {
        const msg = `cannot open "${document.name}" in Publication Preview: ${problem}`;
        toast(msg, "danger");
        set({ status: msg });
        return false;
      }
      const draft = structuredClone(document);
      draft.id = nextFigureId();
      set({
        figurePublicationSession: {
          target: "new-editable",
          windowId: null,
          baseline: structuredClone(draft),
          draft,
        },
        figureBuilderOpen: true,
      });
      return true;
    },
    beginFigurePublicationEditForFigure: (figureId) => {
      const state = get();
      if (state.figurePublicationSession) {
        toast(SESSION_BUSY_MSG, "danger");
        set({ status: SESSION_BUSY_MSG });
        return false;
      }
      const document = state.editableFigures.find((candidate) => candidate.id === figureId);
      if (!document) return false;
      const problem = figurePublicationSourceUnavailable(document, state.datasets);
      if (problem) {
        const msg = `cannot open "${document.name}" in Publication Preview: ${problem}`;
        toast(msg, "danger");
        set({ status: msg });
        return false;
      }
      // Unlike the detached path above, the draft KEEPS the saved figure's own
      // id -- Apply replaces that entry in place rather than minting a new one.
      set({
        figurePublicationSession: {
          target: "library",
          windowId: null,
          baseline: structuredClone(document),
          draft: structuredClone(document),
        },
        figureBuilderOpen: true,
      });
      return true;
    },
    applyFigurePublicationEdit: () => {
      const state = get();
      const session = state.figurePublicationSession;
      if (!session) return false;
      if (session.target === "new-editable") {
        const document = session.draft;
        const problem = figurePublicationSourceUnavailable(document, state.datasets);
        if (problem) {
          const msg = `cannot save editable figure "${document.name}": ${problem}`;
          toast(msg, "danger");
          set({ status: msg });
          return false;
        }
        state.recordHistory("create editable figure");
        set((current) => ({
          editableFigures: [...current.editableFigures, structuredClone(document)],
          figurePublicationSession: null,
          figureBuilderOpen: false,
          status: `created editable figure "${document.name}"; open it from Editable figures`,
        }));
        return true;
      }
      if (session.target === "library") {
        // The staleness/availability checks and the focused-window-sync
        // decision are pure -- see figurePublicationLibrary.ts's doc comment
        // for why a focused window's document additionally needs hydrateView.
        const outcome = resolveLibraryApply(state, session);
        if (outcome.kind !== "ready") {
          const msg = outcome.kind === "stale" ? outcome.toastMsg : outcome.msg;
          toast(msg, "danger");
          set(outcome.kind === "stale"
            ? { status: "publication preview target changed; changes not applied", figurePublicationSession: { ...session, staleBaseline: true } }
            : { status: msg });
          return false;
        }
        const { document, syncFocusedView } = outcome;
        const view = figureDocumentToPlotView(document);
        state.recordHistory("apply publication preview");
        set((current) => ({
          editableFigures: current.editableFigures.map((entry) =>
            entry.id === document.id ? structuredClone(document) : entry,
          ),
          // Sync any open window(s) showing this document by id -- the same
          // convention saveFigure/renameEditableFigure already follow.
          plotWindows: current.plotWindows.map((candidate) =>
            candidate.kind === "plot" && candidate.document?.id === document.id
              ? withPlotWindowDocument(candidate, document)
              : candidate,
          ),
          ...(syncFocusedView ? hydrateView(view) : {}),
          ...(syncFocusedView && document.bindings.facetKey !== session.baseline.bindings.facetKey && current.composition !== null
            ? { composition: null } : {}),
          figurePublicationSession: null,
          figureBuilderOpen: false,
          status: `applied publication preview to "${document.name}"`,
        }));
        return true;
      }
      const window = session && state.plotWindows.find((candidate) => candidate.id === session.windowId);
      const live = window ? liveWindowDocument(state, window) : null;
      if (
        !window ||
        state.focusedWindowId !== session.windowId ||
        window.kind !== "plot" ||
        window.document?.id !== session.baseline.id ||
        !live ||
        JSON.stringify(live) !== JSON.stringify(session.baseline)
      ) {
        if (session) {
          // Item 4: the session survives (its draft is intact — nothing to
          // discard) but Apply is now a dead end against this baseline; flag
          // it so the UI can block Apply and point at the recovery (Cancel +
          // reopen) instead of leaving only a status line to explain why
          // Apply keeps silently failing.
          toast(
            "the plot changed while previewing — Cancel and reopen Publication Preview to pick up the changes",
            "danger",
          );
          set({
            status: "publication preview target changed; changes not applied",
            figurePublicationSession: { ...session, staleBaseline: true },
          });
        }
        return false;
      }
      const document = structuredClone(session.draft);
      const view = figureDocumentToPlotView(document);
      state.recordHistory("apply publication preview");
      set((current) => ({
        plotWindows: current.plotWindows.map((candidate) =>
          candidate.id === session.windowId ? withPlotWindowDocument(candidate, document) : candidate,
        ),
        ...hydrateView(view),
        ...(document.bindings.facetKey !== session.baseline.bindings.facetKey && current.composition !== null
          ? { composition: null } : {}),
        figurePublicationSession: null,
        figureBuilderOpen: false,
        status: `applied publication preview to "${document.name}"`,
      }));
      return true;
    },
    promoteLegacyFigureDoc: (legacyFigureId) => {
      const state = get();
      const legacy = state.figureDocs.find((candidate) => candidate.id === legacyFigureId);
      if (!legacy) {
        const msg = "publication figure was not found; no editable copy created";
        toast(msg, "danger");
        set({ status: msg });
        return null;
      }
      if (
        legacy.live &&
        (!legacy.datasetId || !state.datasets.some((dataset) => dataset.id === legacy.datasetId))
      ) {
        const msg = `cannot create editable copy of "${legacy.name}": source dataset is unavailable`;
        toast(msg, "danger");
        set({ status: msg });
        return null;
      }
      let converted: FigureDocument;
      try {
        converted = figureDocumentFromLegacyFigureDoc(legacy);
      } catch (error) {
        const msg = `cannot create editable copy of "${legacy.name}": ${error instanceof Error ? error.message : "conversion failed"}`;
        toast(msg, "danger");
        set({ status: msg });
        return null;
      }
      const copy = {
        ...converted,
        id: nextFigureId(),
        name: `${legacy.name} (editable copy)`,
      };
      state.recordHistory("create editable figure copy");
      set((current) => ({
        editableFigures: [...current.editableFigures, copy],
        status: `created editable copy of "${legacy.name}"; open it from Editable figures`,
      }));
      return copy.id;
    },
    saveFigureAs: (windowId, name) => {
      const state = get();
      const window = state.plotWindows.find((candidate) => candidate.id === windowId);
      const current = window && liveWindowDocument(state, window);
      const trimmed = name.trim();
      if (!window || !current || !trimmed) return null;
      const document = { ...current, id: nextFigureId(), name: trimmed };
      state.recordHistory("save figure as");
      set((s) => ({
        editableFigures: [...s.editableFigures, document],
        plotWindows: s.plotWindows.map((candidate) =>
          candidate.id === windowId
            ? withPlotWindowDocument(candidate, document)
            : candidate,
        ),
        status: `figure "${trimmed}" saved as a new document`,
      }));
      return document.id;
    },
    openEditableFigure: (documentId) => {
      const state = get();
      const alreadyOpen = state.plotWindows.find(
        (window) => window.kind === "plot" && window.document?.id === documentId,
      );
      if (alreadyOpen) {
        if (alreadyOpen.winState === "minimized") state.restoreWindow(alreadyOpen.id);
        else state.focusWindow(alreadyOpen.id);
        return alreadyOpen.id;
      }
      const document = state.editableFigures.find((candidate) => candidate.id === documentId);
      if (!document) return null;
      const windowId = state.createWindow(document.bindings.datasetId, undefined, document.name);
      set((current) => ({
        plotWindows: current.plotWindows.map((window) =>
          window.id === windowId
            ? withPlotWindowDocument(window, document)
            : window,
        ),
      }));
      get().focusWindow(windowId);
      return windowId;
    },
    renameEditableFigure: (documentId, name) => {
      const trimmed = name.trim();
      if (!trimmed || !get().editableFigures.some((d) => d.id === documentId && d.name !== trimmed)) return; // no-op: no undo step
      get().recordHistory("rename figure");
      set((state) => ({
        editableFigures: state.editableFigures.map((document) =>
          document.id === documentId ? { ...document, name: trimmed } : document,
        ),
        plotWindows: state.plotWindows.map((window) =>
          window.kind === "plot" && window.document?.id === documentId
            ? withPlotWindowDocument(window, { ...window.document, name: trimmed })
            : window,
        ),
      }));
    },
    duplicateEditableFigure: (documentId) => {
      const state = get();
      const source = state.editableFigures.find((candidate) => candidate.id === documentId);
      if (!source) return null;
      const copy = { ...structuredClone(source), id: nextFigureId(), name: `${source.name} copy` };
      state.recordHistory("duplicate figure");
      set((current) => ({ editableFigures: [...current.editableFigures, copy] }));
      return copy.id;
    },
    deleteEditableFigure: (documentId) => {
      const state = get();
      const document = state.editableFigures.find((candidate) => candidate.id === documentId);
      if (!document) return;
      state.recordHistory("delete figure");
      // P3.7: captured BEFORE removal, same two-call convention as
      // removeDatasets (sendToTrash, then the removal set()) — Trash is the
      // recovery path for this deletion the same way it already is for a
      // dataset.
      state.sendEntriesToTrash([
        { kind: "editableFigure", at: Date.now(), bytes: editableFigureByteEstimate(document), document },
      ]);
      set((current) => ({
        editableFigures: current.editableFigures.filter((candidate) => candidate.id !== documentId),
        status: "editable figure deleted (Undo to restore)",
      }));
    },
  };
}
