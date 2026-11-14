// DATASET-LIST EDITS, extracted from store/useApp.ts (audit P4.1, the seventh
// domain — "decompose high-risk frontend god-modules, characterization tests
// first"; store-size ratchet, MAIN_PLAN #2). Composed into the ONE useApp
// store exactly like ./workshopFlags: `useApp` spreads
// `createDatasetListEditsSlice(set, get)` into the store, so every existing
// `useApp((s) => s.folders)` selector and `getState().removeSelected()` call
// keeps working. A code boundary, not a second store.
//
// WHAT THIS MODULE OWNS: the Library's list edits — remove (one / the
// selection / an id list, to Trash or permanently), merge the selection,
// duplicate, reorder, rename — plus the folder tree (create / rename / edit
// properties / delete / move / move-a-dataset / expand) and the smart folders
// (add / edit / remove). 17 actions. The three folder collections (`folders`,
// `expandedFolders`, `smartFolders`) are declared and initialized HERE (an
// own-state slice, store/gadget.ts's shape); `datasets` stays on AppState —
// every slice writes it. The selection/activation group (setActive,
// activateFromLibrary, toggleSelected, selectRange, selectIds) and its
// `activeId`/`selectedIds`/`worksheetId` fields live in ./datasetSelection.
//
// Not exclusive write access: other slices still write the folder fields as
// part of their own gestures (splitRun.ts's split-into-folder, trash.ts's restore, workspaceHydration.ts's .dwk load).
//
// Contract: every action here except `toggleFolderExpanded`, `mergeSelected`,
// the blank-name `addSmartFolder`, the empty `removeSelected` and the
// permanent `removeDatasets` records
// ONE undo step BEFORE its `set()` (so the snapshot is the pre-mutation
// state). `toggleFolderExpanded` is view state, not an edit: undo/redo keep
// the live expand state (historySnapshot.ts's `restoredExpandedFolders`).
// None toasts or records a macro step. `mergeSelected` writes only
// the Reshape & combine dialog store, never this one. The heavy bodies stay
// where they were already homed: `removeDatasetsWithTrash`
// (./removeDatasets) and `deleteFolderWithTrash` (./folderDelete).
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, no React. Only the
// `AppState` TYPE from ./useApp (type-only, so the runtime import graph stays
// one-directional: useApp -> here).
//
// Characterization tests: store/datasetListEdits.characterization.test.ts
// pins the exact keys every action writes (a poisoned whole-getState() diff),
// its undo label and undo/redo round trip, and the absence of toasts/macro
// steps. Written green against the pre-extraction useApp.ts and unchanged by
// the move.

import { formulaExtension } from "../lib/formulaExt";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import {
  createFolder as treeCreateFolder,
  moveDatasetToFolder as treeMoveDatasetToFolder,
  moveFolder as treeMoveFolder,
  renameFolder as treeRenameFolder,
  updateFolder as treeUpdateFolder,
} from "../lib/foldertree";
import type { SmartFolder } from "../lib/smartfolders";
import type { FolderNode } from "../lib/types";
import { deleteFolderWithTrash } from "./folderDelete";
import { nextFolderId, nextSmartFolderId } from "./idSeq";
import { removeDatasetsWithTrash } from "./removeDatasets";
import { openTransformPreview, seedIds } from "./transformPreviewDialog";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface DatasetListEditsSlice {
  // Library folder tree (project-organization plan, Approach B): pure
  // organization over `datasets[]` (`Dataset.folderId`); never gates row-state.
  folders: FolderNode[];
  // Expanded folder ids (Library tree UI state); persisted so a project reopens
  // with the same folders open. Round-trips .dwk v2.
  expandedFolders: string[];
  // Smart folders (item 9): saved tag/name/format queries rendered as
  // cross-cutting Library sections. Membership is DERIVED at render time
  // (lib/smartfolders) — only the queries persist (.dwk).
  smartFolders: SmartFolder[];

  removeDataset: (id: string) => void;
  removeSelected: () => void;
  // Bulk-remove by explicit id list (item 17's book-family filter dialog) —
  // distinct from removeSelected. `{permanent}` (P3.7) bypasses Trash.
  removeDatasets: (ids: string[], opts?: { permanent?: boolean }) => void;
  // clearAll: see store/workspaceHydration.ts (WorkspaceHydrationSlice).
  // Open the previewed append (Reshape & combine) on the selection (P2.5).
  // Its Create resolves any still-pending picks first (#38) — a batch of
  // arbitrary selected datasets is exactly the "never activated" risk case.
  mergeSelected: () => Promise<void>;
  // Resolves a still-pending source first (#38): `pending` isn't copied onto
  // the clone, so without this the copy would silently become a SEPARATE
  // dataset permanently stuck on the small preview (nothing would ever
  // trigger its own fetch).
  duplicateDataset: (id: string) => Promise<void>;
  moveDataset: (id: string, dir: -1 | 1) => void;
  renameDataset: (id: string, name: string) => void;
  // Folder tree (project-organization plan item 1). Thin wrappers over
  // lib/foldertree; datasets stay a flat array (membership is Dataset.folderId).
  createFolder: (parentId: string | null, name?: string) => string;
  renameFolder: (id: string, name: string) => void;
  /** Folder Properties (notes/colour/defaultTemplate) as its OWN undo step;
   *  `renameFolder` owns the name. Moved here from libraryPanel.ts, which has
   *  no `get` to record with. */
  updateFolder: (id: string, patch: { notes?: string; color?: string; defaultTemplate?: string }) => void;
  deleteFolder: (id: string, mode?: "reparent" | "cascade") => void;
  moveFolder: (id: string, newParentId: string | null, beforeId?: string) => void;
  moveDatasetToFolder: (id: string, folderId: string | null, beforeId?: string) => void;
  /** Move a multi-selection into `folderId` (null = top level) as ONE undo step. */
  moveDatasetsToFolder: (ids: readonly string[], folderId: string | null) => void;
  toggleFolderExpanded: (id: string) => void;
  // Smart folders (item 9): saved queries only — membership is derived.
  addSmartFolder: (name: string, query: string) => void;
  updateSmartFolder: (id: string, name: string, query: string) => void;
  removeSmartFolder: (id: string) => void;
}

export function createDatasetListEditsSlice(set: SliceSet, get: SliceGet): DatasetListEditsSlice {
  return {
    folders: [],
    expandedFolders: [],
    smartFolders: [],

    // DELEGATES to removeDatasets (like removeSelected below) rather than
    // repeating its ~25 lines of reference pruning — the single-id path had
    // drifted into its own near-identical copy of the same block; this was the
    // fourth copy removeSelected's own delegation was meant to head off. The
    // only observable difference is the recordHistory label ("remove datasets"
    // instead of "remove dataset"), which no test asserts on.
    removeDataset: (id) => get().removeDatasets([id]),
    // Delete key: remove every selected dataset (falling back to the active one
    // if nothing is multi-selected); reselect the first survivor so the plot
    // recovers. DELEGATES to removeDatasets rather than repeating its ~25 lines
    // of reference pruning (origin figures, fidelity, reports, figure docs, plot
    // windows) — that block had drifted into three near-identical copies, and a
    // new prune target had to be remembered in all of them. The only behaviour
    // this adds on top is the reselect.
    removeSelected: () => {
      const s = get();
      const ids = s.selectedIds.length ? s.selectedIds : s.activeId ? [s.activeId] : [];
      if (ids.length === 0) return;
      get().removeDatasets(ids);
      const activeId = get().activeId;
      set({ selectedIds: activeId ? [activeId] : [] });
    },
    // Bulk-remove by explicit id list (item 17's "manage books" dialog) — unlike
    // removeSelected, this doesn't touch/depend on the transient row selection.
    removeDatasets: (ids, opts) => removeDatasetsWithTrash(get, set, ids, opts),

    // Open the Reshape & combine workshop's append on the selection (P2.5).
    // EAGER, not a lazy lib/transformRun import (finding 8) — Create lazy-loads that chunk.
    mergeSelected: async () => { openTransformPreview("merge", seedIds(get)); },

    // Deep-copy a dataset (incl. raw/corrections/bgRef) as an independent "(copy)"
    // — for trying different corrections/formulas while keeping the original.
    // The body loads on first use (store/duplicateDatasetRun.ts, bundle offset
    // for gap audit 2's live graphs); a failed load is toasted.
    duplicateDataset: (id) =>
      runLazy("Loading duplicate…", () => import("./duplicateDatasetRun")).then((m) => m.runDuplicateDataset(set, get, id), onLoadFailure),
    // Reorder the library by swapping a dataset with its neighbor (dir -1 = up,
    // +1 = down). No-op at the ends or for an unknown id. Order drives the list and
    // the consolidated-export column order; the active selection is unaffected.
    moveDataset: (id, dir) => {
      get().recordHistory("reorder datasets");
      set((s) => {
        const i = s.datasets.findIndex((d) => d.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.datasets.length) return {};
        const datasets = [...s.datasets];
        [datasets[i], datasets[j]] = [datasets[j], datasets[i]];
        return { datasets };
      });
    },
    renameDataset: (id, name) => {
      // A rename that changes nothing (same name, blank, unknown id) records no
      // undo step (review finding: a no-op Library rename did).
      const d = get().datasets.find((x) => x.id === id);
      if (!d || (name.trim() || d.name) === d.name) return;
      // A name sheet("…") links could not show is refused (lib/sheetRefs.ts).
      const refusal = formulaExtension()?.renameRefusal(get().datasets, id, name.trim());
      if (refusal) return get().setStatus(refusal);
      get().recordHistory("rename dataset");
      set((s) => {
        const datasets = s.datasets.map((d) =>
          d.id === id ? { ...d, name: name.trim() || d.name } : d,
        );
        // Formulas LINKED to this worksheet (`sheet("Name", …)`) keep their
        // link and show the new name (lib/sheetRefs.ts).
        const renamed = datasets.find((d) => d.id === id)?.name;
        return { datasets: (renamed && formulaExtension()?.renameSheetRefs(datasets, id, renamed).datasets) || datasets };
      });
    },

    // ── Folder tree (project-organization plan item 1) ──────────────────────
    // All five delegate to the pure lib/foldertree ops; the store only supplies
    // ids and threads state. deleteFolder re-homes datasets (never destroys them).
    createFolder: (parentId, name = "New Folder") => {
      const id = nextFolderId();
      get().recordHistory("create folder");
      set((s) => ({ folders: treeCreateFolder(s.folders, parentId, name, id) }));
      return id;
    },
    renameFolder: (id, name) => {
      const f = get().folders.find((x) => x.id === id);
      if (!f || !name.trim() || name.trim() === f.name) return; // no-op: no undo step
      get().recordHistory("rename folder");
      set((s) => ({ folders: treeRenameFolder(s.folders, id, name) }));
    },
    updateFolder: (id, patch) => (get().recordHistory("edit folder properties"), set((s) => ({ folders: treeUpdateFolder(s.folders, id, patch) }))),
    deleteFolder: (id, mode = "reparent") => deleteFolderWithTrash(get, set, id, mode),
    moveFolder: (id, newParentId, beforeId) => (get().recordHistory("move folder"), set((s) => ({ folders: treeMoveFolder(s.folders, id, newParentId, beforeId) }))),
    moveDatasetToFolder: (id, folderId, beforeId) => (get().recordHistory("move dataset"), set((s) => ({ datasets: treeMoveDatasetToFolder(s.datasets, id, folderId, beforeId) }))),
    moveDatasetsToFolder: (ids, folderId) => {
      if (ids.length === 0) return;
      get().recordHistory(ids.length > 1 ? "move datasets" : "move dataset");
      set((s) => ({ datasets: ids.reduce((next, id) => treeMoveDatasetToFolder(next, id, folderId), s.datasets) }));
    },
    toggleFolderExpanded: (id) =>
      set((s) => ({
        expandedFolders: s.expandedFolders.includes(id)
          ? s.expandedFolders.filter((x) => x !== id)
          : [...s.expandedFolders, id],
      })),

    // ── Smart folders (project-organization plan item 9) ────────────────────
    // Saved queries, nothing else — members are derived per render by
    // lib/smartfolders, so there is no membership state to keep in sync.
    addSmartFolder: (name, query) => {
      if (!name.trim()) return;
      get().recordHistory("add smart folder");
      set((s) => {
        const nm = name.trim();
        return {
          smartFolders: [
            ...s.smartFolders,
            { id: nextSmartFolderId(), name: nm, query: query.trim() },
          ],
        };
      });
    },
    updateSmartFolder: (id, name, query) => (get().recordHistory("edit smart folder"), set((s) => ({
        smartFolders: s.smartFolders.map((f) =>
          f.id === id ? { ...f, name: name.trim() || f.name, query: query.trim() } : f,
        ),
      }))),
    removeSmartFolder: (id) => (get().recordHistory("remove smart folder"), set((s) => ({ smartFolders: s.smartFolders.filter((f) => f.id !== id) }))),
  };
}
