// Editable FigureDocument lifecycle. These are the canonical, reopenable plot
// documents; legacy FigureDoc objects remain the Publication Preview model.
import {
  figureDocumentToPlotView,
  updateFigureDocumentFromPlotView,
  type FigureDocument,
} from "../lib/figureDocument";
import { snapshotView, type PlotWindow } from "../lib/plotview";
import type { AppState } from "./useApp";

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

export interface FigureLifecycleSlice {
  editableFigures: FigureDocument[];
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
          candidate.id === windowId ? { ...candidate, document, view: figureDocumentToPlotView(document) } : candidate,
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
            ? { ...candidate, title: trimmed, document, view: figureDocumentToPlotView(document) }
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
      const view = figureDocumentToPlotView(document);
      const windowId = state.createWindow(document.bindings.datasetId, view, document.name);
      set((current) => ({
        plotWindows: current.plotWindows.map((window) =>
          window.id === windowId
            ? {
                ...window,
                title: document.name,
                datasetId: document.bindings.datasetId,
                view,
                document: structuredClone(document),
              }
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
            ? { ...window, title: trimmed, document: { ...window.document, name: trimmed } }
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
