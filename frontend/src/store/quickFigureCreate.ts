// Quick Figure Builder's commit action (plan G4). A sibling slice file
// rather than another method on FigureLifecycleSlice, for the exact reason
// store/quickPlotAction.ts is one: figureLifecycle.ts sits close enough to
// architecture.test.ts's 500-line ceiling that this action would push it
// over, and useApp.ts itself is banked only ~35 lines under its own
// store-size ratchet pin -- same "extract a cohesive sibling instead of
// raising a pin" convention store/datasetMeta.ts and store/cellEdit.ts
// already follow.
//
// This MIRRORS quickPlotDataset's exact inline sequence
// (store/quickPlotAction.ts:57-87) verbatim -- that file's header explains
// the ONE-undo shape in full; the short version: `createWindow`
// (store/windows.ts) already calls `recordHistory` internally and
// unconditionally, so it must run FIRST and be the gesture's ONLY
// `recordHistory` call. Every remaining mutation (the document, the
// window's document attachment, the status line) rides along in the SAME
// undo unit via plain `set()` calls with no further `recordHistory` --
// calling a second one here would strand the just-created FigureDocument
// after a single Undo, exactly the bug quickPlotDataset's fix #4 closed.
//
// Where this action differs from quickPlotDataset: the SEED comes from the
// Quick Figure Builder's already-confirmed (dataset, mapping, style) via the
// pure `quickFigureCommit` (lib/quickFigureCommit.ts) instead of
// `quickPlotFigureSeed`'s technique-inferred view, and the document carries
// the mapping's own rich `errors` (asymmetric/X-error capable) rather than
// falling back to the legacy `errKeys` projection.
import { createFigureDocument } from "../lib/figureDocument";
import { dedupeWindowTitle } from "../lib/plotview";
import { quickFigureCommit } from "../lib/quickFigureCommit";
import { mappingReady, type QuickFigureMapping } from "../lib/quickFigureMapping";
import type { QuickPlotStyle } from "../lib/quickFigurePreview";
import { nextFigureId } from "./figureLifecycle";
import type { AppState } from "./useApp";
import { withPlotWindowDocument } from "./windowDocuments";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface QuickFigureCreateSlice {
  /** Commit the Quick Figure Builder's mapping draft ONCE through the
   *  canonical FigureDocument lifecycle: a NEW editable figure, opened in a
   *  fresh window, as ONE undoable gesture. Returns true on success; a
   *  fail-closed no-op (false, with a status message, no history entry, no
   *  new document or window) when the dataset has vanished mid-gesture or
   *  the mapping is not ready (belt-and-braces -- the Create button is
   *  already gated on `mappingReady`). */
  createQuickFigureFromMapping: (datasetId: string, mapping: QuickFigureMapping, style: QuickPlotStyle) => boolean;
}

export function createQuickFigureCreateSlice(set: SliceSet, get: SliceGet): QuickFigureCreateSlice {
  return {
    createQuickFigureFromMapping: (datasetId, mapping, style) => {
      const state = get();
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset) {
        set({ status: "Quick Figure Builder unavailable: dataset not found" });
        return false;
      }
      if (!mappingReady(mapping)) {
        set({ status: "Quick Figure Builder unavailable: assign at least one Y series" });
        return false;
      }
      const pieces = quickFigureCommit(dataset, mapping, style);
      const name = dedupeWindowTitle(pieces.name, state.editableFigures.map((f) => f.name));
      const windowId = state.createWindow(dataset.id, pieces.view, name); // the gesture's one recordHistory
      const id = nextFigureId();
      const document = createFigureDocument({
        id,
        name,
        datasetId: dataset.id,
        view: pieces.view,
        mark: pieces.mark,
        errors: pieces.errors,
      });
      set((current) => ({
        editableFigures: [...current.editableFigures, document],
        plotWindows: current.plotWindows.map((w) =>
          w.id === windowId ? withPlotWindowDocument(w, document) : w,
        ),
        status: `created "${document.name}" from Quick Figure Builder`,
      }));
      get().focusWindow(windowId);
      return true;
    },
  };
}
