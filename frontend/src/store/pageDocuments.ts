// Persisted multi-panel Figure Page library (FIGURE_AUTHORING_WORKFLOW_PLAN
// F3.1/F3.3) — the versioned PageDocument collection round-tripped through
// .dwk (lib/workspace.ts) and autosave, mirroring editableFigures
// (store/figureLifecycle.ts)'s slice shape. F3.1 only owned the persisted
// collection itself; F3.3 adds the actual lifecycle actions (Save, Save As,
// rename, duplicate, delete, reopen) — the Figure Page workshop's session
// state is plain React state (components/workshops/figurepage/useFigurePage.ts),
// not a store slice, so "reopen" works the same way opening a legacy FigureDoc
// into the figure builder does: seed a value here (`pageDocSeed`) and let the
// workshop's own effect consume it once.
import type { PageDocument } from "../lib/pageDocument";
import type { AppState } from "./useApp";

let pageSequence = 0;
const nextPageId = (): string => `page-${Date.now().toString(36)}-${++pageSequence}`;

export interface PageDocumentSlice {
  pages: PageDocument[];
  /** One-shot seed for reopening a saved page into the Figure Page workshop —
   *  consumed and cleared by useFigurePage.ts's effect, mirroring
   *  `figureDocSeed`/`clearFigureDocSeed`'s pattern for the figure builder. */
  pageDocSeed: PageDocument | null;
  clearPageDocSeed: () => void;
  /** Open a saved page for editing: seeds `pageDocSeed` and raises the
   *  workshop window. Always overwrites any in-progress session the same way
   *  `figureDocSeed`'s consuming effect already does for the figure builder —
   *  not a new confirmation surface (F3.3's close-confirm gate covers the
   *  distinct "closing the window" discard path, not "switching pages"). */
  openPageDocument: (id: string) => boolean;
  /** Upsert `document` into `pages` by id — the FIRST save for a fresh
   *  session (its id was never in `pages`) inserts; every later save updates
   *  in place, exactly like `saveFigure`. Stamps `modifiedAt` now. */
  savePage: (document: PageDocument) => string;
  /** Always creates a NEW id (like `saveFigureAs`) — the session that called
   *  this should rebind its local draft to the returned id so its NEXT plain
   *  Save updates the new entry instead of creating another one. */
  savePageAs: (document: PageDocument, name: string) => string | null;
  renamePageDocument: (id: string, name: string) => void;
  duplicatePageDocument: (id: string) => string | null;
  deletePageDocument: (id: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createPageDocumentsSlice(set: SliceSet, get: SliceGet): PageDocumentSlice {
  return {
    pages: [],
    pageDocSeed: null,
    clearPageDocSeed: () => set({ pageDocSeed: null }),
    openPageDocument: (id) => {
      const document = get().pages.find((candidate) => candidate.id === id);
      if (!document) return false;
      set({ pageDocSeed: structuredClone(document), figurePageOpen: true });
      return true;
    },
    savePage: (document) => {
      const saved: PageDocument = { ...document, modifiedAt: new Date().toISOString() };
      get().recordHistory("save figure page");
      set((state) => ({
        pages: state.pages.some((p) => p.id === saved.id)
          ? state.pages.map((p) => (p.id === saved.id ? saved : p))
          : [...state.pages, saved],
        status: `figure page "${saved.name}" saved`,
      }));
      return saved.id;
    },
    savePageAs: (document, name) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const now = new Date().toISOString();
      const saved: PageDocument = { ...document, id: nextPageId(), name: trimmed, createdAt: now, modifiedAt: now };
      get().recordHistory("save figure page as");
      set((state) => ({
        pages: [...state.pages, saved],
        status: `figure page "${trimmed}" saved as a new document`,
      }));
      return saved.id;
    },
    renamePageDocument: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      get().recordHistory("rename figure page");
      set((state) => ({
        pages: state.pages.map((p) =>
          p.id === id ? { ...p, name: trimmed, modifiedAt: new Date().toISOString() } : p,
        ),
      }));
    },
    duplicatePageDocument: (id) => {
      const source = get().pages.find((candidate) => candidate.id === id);
      if (!source) return null;
      const now = new Date().toISOString();
      const copy: PageDocument = {
        ...structuredClone(source),
        id: nextPageId(),
        name: `${source.name} copy`,
        createdAt: now,
        modifiedAt: now,
      };
      get().recordHistory("duplicate figure page");
      set((state) => ({ pages: [...state.pages, copy] }));
      return copy.id;
    },
    deletePageDocument: (id) => {
      if (!get().pages.some((p) => p.id === id)) return;
      get().recordHistory("delete figure page");
      set((state) => ({
        pages: state.pages.filter((p) => p.id !== id),
        status: "figure page deleted (Undo to restore)",
      }));
    },
  };
}
