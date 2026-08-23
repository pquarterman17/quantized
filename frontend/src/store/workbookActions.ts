// The first WORKBOOK mutations (LIBRARY_WORKBOOK_UX_PLAN PR C) — composed
// into useApp exactly like store/datasetMeta.ts (see that file's header):
// owns no state of its own, mutates the shared `workbooks`/`datasets` fields
// through set/get like every other slice acting on state it doesn't own.
// `workbooks` already rides HistorySnapshot (added ahead of any mutator in
// PR A2, see history.ts), so every action here inherits undo for free.

import { pruneDanglingWorkbookScopeTemplates } from "../lib/quickPlotTemplates";
import { removeDatasetsPatch } from "./removeDatasets";
import type { AppState } from "./useApp";

/** L0.45 gate (PR #139 review, round 3; LIFTED by PR M, 2026-08-19): workbook
 *  Delete was disabled UNCONDITIONALLY pending dependency-aware handling —
 *  the concern was that Trash stores only individual Dataset snapshots, so
 *  deleting a workbook loses the grouping itself and restoring sheets one
 *  at a time re-derives SEPARATE workbooks. PR M does not build a second,
 *  workbook-aware Trash format (booked as a later item — see the plan); it
 *  resolves the SAME concern the L0.45 way instead: the command's own
 *  confirm dialog (lib/workbookContextActions.ts's `workbook.delete`) now
 *  states this consequence explicitly — "the grouping itself is removed for
 *  good; each worksheet restored later becomes its own new workbook" — plus
 *  the FULL downstream dependency impact (lib/dependencyImpact.ts, the K
 *  graph) — before the user confirms. Nothing is broken silently (L0.45's
 *  actual requirement); the user chooses with full information. Kept as a
 *  function (not just deleted) so a future GENUINE blocking condition has
 *  somewhere to live without re-threading three call sites again. */
export function workbookDeleteBlockers(_s: AppState, _workbookId: string): string | null {
  return null;
}

export interface WorkbookActionsSlice {
  /** Blank name = no-op (matches renameFolder/renameDataset's own guard). */
  renameWorkbook: (id: string, name: string) => void;
  /** A2 folder placement is owned by the workbook (lib/workbooks.ts's header):
   *  moving a workbook re-homes every member dataset's `folderId` in the same
   *  action so search/reveal/smart-folders — every legacy consumer that still
   *  reads `Dataset.folderId` directly — stay in sync. */
  moveWorkbookToFolder: (id: string, folderId: string | null) => void;
  /** L0.22/L0.45/L0.36 (PR H booked finding): ONE atomic update under ONE
   *  history entry — the shared `removeDatasetsPatch` (members to Trash) AND
   *  the workbook-scoped Quick Plot templates that named this workbook
   *  (H's `pruneDanglingWorkbookScopeTemplates`, reused verbatim: the
   *  workbook is about to stop existing, the exact predicate that function
   *  already tests) — so undo restores workbook, members, AND their
   *  templates together, never a partial state. */
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
      set((s2) => {
        const workbooks = s2.workbooks.filter((w) => w.id !== id);
        // PR H booked finding: prune this workbook's OWN scoped Quick Plot
        // templates in the SAME atomic update — `pruneDanglingWorkbookScopeTemplates`
        // already tests exactly "does this template's workbookId still name
        // a LIVE workbook", so the post-delete `workbooks` list is enough.
        return {
          ...removeDatasetsPatch(s2, memberIds),
          workbooks,
          quickPlotTemplates: pruneDanglingWorkbookScopeTemplates(
            s2.quickPlotTemplates,
            new Set(workbooks.map((w) => w.id)),
          ),
        };
      });
    },
  };
}
