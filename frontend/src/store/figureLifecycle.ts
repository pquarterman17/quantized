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
  const current = liveWindowDocument(state, window);
  if (!current) return false;
  const saved = state.editableFigures.find((document) => document.id === current.id);
  return !saved || JSON.stringify(saved) !== JSON.stringify(current);
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
