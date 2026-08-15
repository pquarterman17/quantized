// The first WORKBOOK mutations (LIBRARY_WORKBOOK_UX_PLAN PR C) — composed
// into useApp exactly like store/datasetMeta.ts (see that file's header):
// owns no state of its own, mutates the shared `workbooks`/`datasets` fields
// through set/get like every other slice acting on state it doesn't own.
// `workbooks` already rides HistorySnapshot (added ahead of any mutator in
// PR A2, see history.ts), so every action here inherits undo for free.

import { removeDatasetsPatch } from "./removeDatasets";
import type { AppState } from "./useApp";

/** L0.45 fail-closed gate (PR #139 review): the human-readable reason
 *  workbook Delete is unavailable, or null when it may run. Deleting a
 *  workbook trashes only Dataset snapshots — recovered Origin figures,
 *  reports, and publication/editable figure bindings that reference a
 *  member would be pruned UNRECOVERABLY — so while any such dependent
 *  exists the command is disabled with this reason (PR M owns the
 *  dependency-aware Trash that will lift it). Plot-window bindings and
 *  Origin fidelity records deliberately do NOT block: both already follow
 *  plain dataset-delete semantics (windows rebind; fidelity is derived
 *  import metadata), and blocking on them would disable Delete for every
 *  currently-plotted workbook. Shared by the menu registry
 *  (lib/workbookContextActions.ts) and re-checked inside `deleteWorkbook`
 *  itself so no caller can bypass the gate. */
export function workbookDeleteBlockers(s: AppState, workbookId: string): string | null {
  const members = new Set(s.datasets.filter((d) => d.workbookId === workbookId).map((d) => d.id));
  const refs = (id: string | null | undefined) => id != null && members.has(id);
  const n =
    s.originFigures.filter((f) => refs(f.datasetId)).length +
    s.reports.filter((r) => refs(r.datasetId)).length +
    s.figureDocs.filter((f) => refs(f.datasetId)).length +
    s.editableFigures.filter((f) => refs(f.bindings.datasetId)).length;
  if (n === 0) return null;
  return `${n} dependent figure${n === 1 ? "" : "s"}/report${n === 1 ? "" : "s"} would be lost — available after dependency-aware Trash (PR M)`;
}

export interface WorkbookActionsSlice {
  /** Blank name = no-op (matches renameFolder/renameDataset's own guard). */
  renameWorkbook: (id: string, name: string) => void;
  /** A2 folder placement is owned by the workbook (lib/workbooks.ts's header):
   *  moving a workbook re-homes every member dataset's `folderId` in the same
   *  action so search/reveal/smart-folders — every legacy consumer that still
   *  reads `Dataset.folderId` directly — stay in sync. */
  moveWorkbookToFolder: (id: string, folderId: string | null) => void;
  /** L0.22/L0.45: the visible command is "Delete"; members route through the
   *  SAME recoverable Trash path a plain dataset delete uses (store/trash.ts)
   *  in ONE atomic update under ONE history entry (one Delete, one Undo).
   *  Fail-closed on dependents via `workbookDeleteBlockers` — the M-owned
   *  dependency review is deliberately NOT built here (PR M). */
  deleteWorkbook: (id: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createWorkbookActionsSlice(set: SliceSet, get: SliceGet): WorkbookActionsSlice {
  return {
    renameWorkbook: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      get().recordHistory("rename workbook");
      set((s) => ({
        workbooks: s.workbooks.map((w) => (w.id === id ? { ...w, name: trimmed } : w)),
      }));
    },

    moveWorkbookToFolder: (id, folderId) => {
      get().recordHistory("move workbook");
      set((s) => ({
        workbooks: s.workbooks.map((w) => (w.id === id ? { ...w, folderId: folderId ?? undefined } : w)),
        datasets: s.datasets.map((d) => (d.workbookId === id ? { ...d, folderId: folderId ?? undefined } : d)),
      }));
    },

    deleteWorkbook: (id) => {
      const s = get();
      if (!s.workbooks.some((w) => w.id === id)) return;
      if (workbookDeleteBlockers(s, id) != null) return; // fail closed — the menu shows the reason
      const memberIds = s.datasets.filter((d) => d.workbookId === id).map((d) => d.id);
      // ONE history entry, ONE set() (PR #139 review): the same
      // removeDatasetsPatch the removeDatasets ACTION applies — members land
      // in the SAME recoverable Trash with the SAME reference pruning, never
      // a second divergent delete mechanism — composed with the workbook
      // removal so a single Undo restores workbook + members together.
      get().recordHistory("delete workbook");
      get().sendToTrash(s.datasets.filter((d) => memberIds.includes(d.id)));
      set((s2) => ({
        ...removeDatasetsPatch(s2, memberIds),
        workbooks: s2.workbooks.filter((w) => w.id !== id),
      }));
    },
  };
}
