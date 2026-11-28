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
//
// P1 fix (adversarial review, 2026-08-18): folder placement is owned by the
// WORKBOOK, not the dataset (lib/workbooks.ts:52-54's `WorkbookNode.folderId`
// doc) — `moveWorkbookToFolder` (workbookActions.ts) re-homes every member's
// `folderId` in the SAME action for exactly this reason: `Dataset.folderId`
// is read directly by lib/foldertree.ts's `folderDatasets` (Folder view),
// SmartFoldersSection, and the dataset row menu, all independent of the
// workbook tree. Leaving a moved worksheet's `folderId` pointing at its OLD
// folder split-brains those two views. Combine never suggests a folder for
// the new workbook (no "shared folder" concept in L0.32-L0.34), so it lands
// at the Library root (`folderId` undefined) — and every moved worksheet's
// `folderId` is set to match, UNCONDITIONALLY (mirrors
// `moveWorkbookToFolder`'s own `folderId ?? undefined` — never "only if it
// had one"), so the new workbook's placement and its members' folder-view
// placement can never disagree.

import type { CombineSelection } from "../lib/workbookCombine";
import { miscActions } from "./miscActionsLazy";
import type { AppState } from "./useApp";

export type { CombineSelection } from "../lib/workbookCombine";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface WorkbookCombineSlice {
  /** Combine `selection` (whole workbooks and/or individual worksheets) into
   *  ONE freshly-minted workbook named `name` (prompted for by the caller —
   *  see `lib/combinedWorkbookName.ts`'s `suggestCombinedWorkbookName` for the
   *  dialog's default-name suggestion). Refuses (no mutation, no history
   *  entry, a status message) when the selection resolves to zero worksheets
   *  or `name` is blank. Every moved worksheet's own display name is
   *  deduped against ITS NEW SIBLINGS ONLY (L0.34) — its source path/import
   *  time and every other field ride along untouched, EXCEPT `folderId`,
   *  which is re-homed to the new workbook's own (the Library root — see
   *  this file's header P1 note) so Folder view / smart folders can never
   *  disagree with the workbook tree about where a moved worksheet lives.
   *  One history entry. Returns the new workbook's id, or null on refusal. */
  combineWorkbooks: (selection: CombineSelection, name: string) => string | null;
}

export function createWorkbookCombineSlice(set: SliceSet, get: SliceGet): WorkbookCombineSlice {
  return {
    combineWorkbooks: miscActions(set, get).combineWorkbooks,
  };
}
