// "Label peaks" helpers for the Peaks workshop, split out of usePeaks.ts
// (2026-09-29) to fund the Advanced peak-find settings under that hook's
// 500-line module ceiling. Moved verbatim; see the notes on each.

import { toast } from "../../../store/toasts";

// Local id sequence for a "Label peaks" run's shared `Annotation.groupId`
// (MY RULING 2) — same `Date.now().toString(36)` + module-scoped counter
// shape as every other id generator in the store (e.g. useApp.ts's
// `nextFigureId`/`_annSeq`), kept local here since group ids for this
// feature are minted nowhere else.
let _labelGroupSeq = 0;
export function nextLabelGroupId(): string {
  return `peak-labels-${Date.now().toString(36)}-${++_labelGroupSeq}`;
}

/** L5 review finding: `withHistoryBatch` folds ANY caller into whichever
 *  batch happens to already be in flight — not just a genuinely nested call
 *  from the SAME operation (see history.ts's `withHistoryBatch`: its
 *  reentrant check is keyed only on "is a batch running", not on caller
 *  identity). Reachable from the UI: `relink.ts`'s `importChangedAsNewVersion`
 *  (and `reimportAllRun.ts`'s bulk re-import) call `withHistoryBatch` with a
 *  real internal `await` (`importPaths`'s network round trips), and nothing
 *  disables the rest of the app — including an already-open Peaks panel —
 *  while that's in flight. Without this guard, labeling mid-import would
 *  silently ride the import's ONE undo entry: a single Ctrl+Z would revert
 *  the import AND delete every label. Same pre-flight-check + toast shape as
 *  `commands/fileCommands.ts`'s `rejectIfImportRunning` (`isImportRunning`,
 *  store/importBatch.ts) — a cooperative, not a hard, lock: it narrows
 *  the window rather than eliminating it (see the two call sites in usePeaks.ts).
 *  `historySuppressed` is the store's live flag, read by the
 *  caller at the moment of the check. */
export function rejectIfHistoryBatchRunning(historySuppressed: boolean): boolean {
  if (!historySuppressed) return false;
  toast("Another operation is in progress — try Label peaks again in a moment.", "danger");
  return true;
}
