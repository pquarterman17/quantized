// Editable FigureDocument lifecycle. These are the canonical, reopenable plot
// documents; legacy FigureDoc objects remain the Publication Preview model.
import {
  figureDocumentToPlotView,
  updateFigureDocumentFromPlotView,
  type FigureDocument,
} from "../lib/figureDocument";
import { figureDocumentFromLegacyFigureDoc } from "../lib/figureDocumentPublication";
import { hydrateView, snapshotView, type PlotWindow } from "../lib/plotview";
import type { AppState } from "./useApp";
import { withPlotWindowDocument } from "./windowDocuments";

let figureSequence = 0;
const nextFigureId = (): string => `figure-${Date.now().toString(36)}-${++figureSequence}`;

type SliceSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Return the canonical document with the focused facade folded into it. */
export function liveWindowDocument(state: AppState, window: PlotWindow): FigureDocument | null {
  if (window.kind !== "plot" || !window.document) return null;
  return window.id === state.focusedWindowId
    ? updateFigureDocumentFromPlotView(window.document, {
        view: snapshotView(state),
        name: window.title,
        datasetId: window.datasetId,
      })
    : structuredClone(window.document);
}

export function editableFigureDirty(state: AppState, window: PlotWindow): boolean {
  if (window.kind !== "plot" || !window.document) return false;
  // Cheap path first: this runs inside a per-window Zustand selector on EVERY
  // store notification (including pointermove-rate window drags), and the
  // common case — a window never saved as a figure — needs no document
  // rebuild or stringify to answer. The id never changes with the live
  // facade, so the lookup is equivalent to resolving the live document.
  const saved = state.editableFigures.find((document) => document.id === window.document?.id);
  if (!saved) return true;
  const current = liveWindowDocument(state, window);
  return current !== null && JSON.stringify(saved) !== JSON.stringify(current);
}

/** True only when a SAVED editable figure has drifted from the window's live
 *  state. Distinct from `editableFigureDirty` (which is also true for a
 *  window never saved as a figure — the titlebar ● indicator's meaning):
 *  destructive-action confirms are reserved for the opted-in saved-figure
 *  case. Closing a never-saved window is fully undoable (closeWindow records
 *  history and plotWindows is in the history snapshot) and the window
 *  persists in the workspace regardless, so per the confirm-exemption
 *  convention (GUI_INTERACTION #17: undoable actions don't confirm) it must
 *  not gate a routine MDI close. */
export function editableFigureHasUnsavedEdits(state: AppState, window: PlotWindow): boolean {
  if (window.kind !== "plot" || !window.document) return false;
  const saved = state.editableFigures.find((document) => document.id === window.document?.id);
  if (!saved) return false;
  const current = liveWindowDocument(state, window);
  return current !== null && JSON.stringify(saved) !== JSON.stringify(current);
}

export function pruneEditableFigureRefs(
  documents: readonly FigureDocument[],
  removed: ReadonlySet<string>,
): FigureDocument[] {
  return documents.map((document) =>
    document.bindings.datasetId && removed.has(document.bindings.datasetId)
      ? { ...document, bindings: { ...document.bindings, datasetId: null } }
      : document,
  );
}

/** A transient Publication Preview edit: never persisted or history-tracked
 * until Apply updates its target or creates its detached editable document. */
export interface FigurePublicationSession {
  /** `window` updates a verified focused facade; `new-editable` saves a
   * detached canonical draft only when the user explicitly applies it. */
  target: "window" | "new-editable";
  windowId: string | null;
  baseline: FigureDocument;
  draft: FigureDocument;
}

export function figurePublicationDirty(session: FigurePublicationSession | null): boolean {
  return session !== null && JSON.stringify(session.baseline) !== JSON.stringify(session.draft);
}

export interface FigureLifecycleSlice {
  editableFigures: FigureDocument[];
  figurePublicationSession: FigurePublicationSession | null;
  beginFigurePublicationEdit: (windowId?: string) => boolean;
  beginDetachedFigurePublicationEdit: (document: FigureDocument) => boolean;
  replaceFigurePublicationDraft: (draft: FigureDocument) => void;
  patchFigurePublicationDraft: (patch: (draft: FigureDocument) => FigureDocument) => void;
  applyFigurePublicationEdit: () => boolean;
  cancelFigurePublicationEdit: () => void;
  /** Explicitly promote one legacy Publication Preview figure into a new
   * canonical editable copy. The legacy source is never changed. */
  promoteLegacyFigureDoc: (legacyFigureId: string) => string | null;
  saveFigure: (windowId: string) => string | null;
  saveFigureAs: (windowId: string, name: string) => string | null;
  openEditableFigure: (documentId: string) => string | null;
  renameEditableFigure: (documentId: string, name: string) => void;
  duplicateEditableFigure: (documentId: string) => string | null;
  deleteEditableFigure: (documentId: string) => void;
}

export function createFigureLifecycleSlice(set: SliceSet, get: SliceGet): FigureLifecycleSlice {
  return {
    editableFigures: [],
    figurePublicationSession: null,
    beginFigurePublicationEdit: (requestedWindowId) => {
      const state = get();
      if (state.figurePublicationSession) {
        set({ status: "finish or cancel the current Publication Preview before opening another" });
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
        set({ status: "finish or cancel the current Publication Preview before opening another" });
        return false;
      }
      if (
        document.data.mode === "live" &&
        (!document.bindings.datasetId || !state.datasets.some((dataset) => dataset.id === document.bindings.datasetId))
      ) {
        set({ status: `cannot open "${document.name}" in Publication Preview: source dataset is unavailable` });
        return false;
      }
      if (document.data.mode === "frozen" && !document.data.snapshot) {
        set({ status: `cannot open "${document.name}" in Publication Preview: frozen data is unavailable` });
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
    replaceFigurePublicationDraft: (draft) => set((state) =>
      state.figurePublicationSession
        ? { figurePublicationSession: { ...state.figurePublicationSession, draft: structuredClone(draft) } }
        : {},
    ),
    patchFigurePublicationDraft: (patch) => set((state) => {
      const session = state.figurePublicationSession;
      if (!session) return {};
      const draft = patch(structuredClone(session.draft));
      return { figurePublicationSession: { ...session, draft: structuredClone(draft) } };
    }),
    applyFigurePublicationEdit: () => {
      const state = get();
      const session = state.figurePublicationSession;
      if (!session) return false;
      if (session.target === "new-editable") {
        const document = session.draft;
        if (
          document.data.mode === "live" &&
          (!document.bindings.datasetId || !state.datasets.some((dataset) => dataset.id === document.bindings.datasetId))
        ) {
          set({ status: `cannot save editable figure "${document.name}": source dataset is unavailable` });
          return false;
        }
        if (document.data.mode === "frozen" && !document.data.snapshot) {
          set({ status: `cannot save editable figure "${document.name}": frozen data is unavailable` });
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
        if (session) set({ status: "publication preview target changed; changes not applied" });
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
        figurePublicationSession: null,
        figureBuilderOpen: false,
        status: `applied publication preview to "${document.name}"`,
      }));
      return true;
    },
    cancelFigurePublicationEdit: () => set({ figurePublicationSession: null, figureBuilderOpen: false }),
    promoteLegacyFigureDoc: (legacyFigureId) => {
      const state = get();
      const legacy = state.figureDocs.find((candidate) => candidate.id === legacyFigureId);
      if (!legacy) {
        set({ status: "publication figure was not found; no editable copy created" });
        return null;
      }
      if (
        legacy.live &&
        (!legacy.datasetId || !state.datasets.some((dataset) => dataset.id === legacy.datasetId))
      ) {
        set({ status: `cannot create editable copy of "${legacy.name}": source dataset is unavailable` });
        return null;
      }
      let converted: FigureDocument;
      try {
        converted = figureDocumentFromLegacyFigureDoc(legacy);
      } catch (error) {
        set({
          status: `cannot create editable copy of "${legacy.name}": ${error instanceof Error ? error.message : "conversion failed"}`,
        });
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
    saveFigure: (windowId) => {
      const state = get();
      const window = state.plotWindows.find((candidate) => candidate.id === windowId);
      const document = window && liveWindowDocument(state, window);
      if (!window || !document) return null;
      state.recordHistory("save figure");
      set((current) => ({
        editableFigures: current.editableFigures.some((saved) => saved.id === document.id)
          ? current.editableFigures.map((saved) => saved.id === document.id ? document : saved)
          : [...current.editableFigures, document],
        plotWindows: current.plotWindows.map((candidate) =>
          candidate.id === windowId ? withPlotWindowDocument(candidate, document) : candidate,
        ),
        status: `figure "${document.name}" saved`,
      }));
      return document.id;
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
      if (!trimmed) return;
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
      if (!state.editableFigures.some((document) => document.id === documentId)) return;
      state.recordHistory("delete figure");
      set((current) => ({
        editableFigures: current.editableFigures.filter((document) => document.id !== documentId),
        status: "editable figure deleted (Undo to restore)",
      }));
    },
  };
}
