// Explicit workbook COMBINE (LIBRARY_WORKBOOK_UX_PLAN PR J slice 1 —
// L0.32-L0.34) — composed into useApp exactly like store/workbookActions.ts
// (see that file's header): owns no state of its own, mutates the shared
// `workbooks`/`datasets` fields through set/get. `workbooks`/`datasets`
// already ride HistorySnapshot, so this inherits undo for free.
//
// Combine is a SAME-DOCUMENT reorganization (see lib/workbookCombine.ts's
// header for why there's no id remapping to do, and why P1.4's `cat_levels`
// merge contract does not apply here). Source workbooks are deliberately
// NEVER deleted, even when every one of their members was selected — a
// workbook-scoped Quick Plot template's `pruneDanglingWorkbookScopeTemplates`
// only fires when its OWNING workbook is gone from `workbooks[]`, and PR M
// (not this PR) owns that delete/prune contract (see workbookActions.ts's
// `workbookDeleteBlockers` for the identical boundary on workbook Delete).
// A source workbook left with zero members is exactly the plan's documented
// "memberless-but-alive" state, reachable through the manage surface like
// any other, not a bug this PR introduces.

import { nextWorkbookId } from "./workbookIds";
import { toast } from "./toasts";
import {
  dedupeWorksheetNames,
  resolveCombineTargets,
  type CombineSelection,
} from "../lib/workbookCombine";
import type { WorkbookNode } from "../lib/workbooks";
import type { AppState } from "./useApp";

export type { CombineSelection } from "../lib/workbookCombine";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface WorkbookCombineSlice {
  /** Combine `selection` (whole workbooks and/or individual worksheets) into
   *  ONE freshly-minted workbook named `name` (prompted for by the caller —
   *  see `lib/workbookCombine.ts`'s `suggestCombinedWorkbookName` for the
   *  dialog's default-name suggestion). Refuses (no mutation, no history
   *  entry, a status message) when the selection resolves to zero worksheets
   *  or `name` is blank. Every moved worksheet's own display name is
   *  deduped against ITS NEW SIBLINGS ONLY (L0.34) — its source path/import
   *  time and every other field ride along untouched. One history entry.
   *  Returns the new workbook's id, or null on refusal. */
  combineWorkbooks: (selection: CombineSelection, name: string) => string | null;
}

export function createWorkbookCombineSlice(set: SliceSet, get: SliceGet): WorkbookCombineSlice {
  return {
    combineWorkbooks: (selection, name) => {
      const s = get();
      const targetIds = resolveCombineTargets(selection, s.datasets);
      if (targetIds.length === 0) {
        s.setStatus("Combine unavailable: nothing selected");
        return null;
      }
      const trimmedName = name.trim();
      if (!trimmedName) {
        s.setStatus("Combine unavailable: a workbook name is required");
        return null;
      }

      const newId = nextWorkbookId();
      const targetSet = new Set(targetIds);
      const orderedNames = targetIds.map((id) => s.datasets.find((d) => d.id === id)!.name);
      const dedupedNames = dedupeWorksheetNames(orderedNames);
      const nameById = new Map(targetIds.map((id, i) => [id, dedupedNames[i]]));

      get().recordHistory("combine workbooks");
      const workbook: WorkbookNode = { id: newId, name: trimmedName };
      set((st) => ({
        workbooks: [...st.workbooks, workbook],
        datasets: st.datasets.map((d) =>
          targetSet.has(d.id) ? { ...d, workbookId: newId, name: nameById.get(d.id)! } : d,
        ),
      }));

      const count = targetIds.length;
      toast(`combined ${count} worksheet${count === 1 ? "" : "s"} into "${trimmedName}"`, "ok");
      get().setStatus(`combined ${count} worksheet${count === 1 ? "" : "s"} into "${trimmedName}"`);
      return newId;
    },
  };
}
