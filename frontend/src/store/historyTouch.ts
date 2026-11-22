// Undo/redo and the recalc engine. Restoring a snapshot swaps whole datasets
// back in, which `touchDataset` never sees: a derived worksheet or committed
// output that Auto recalculated from the edited view kept reading "Current"
// after Undo, and Manual/None marks were not refreshed either. After a restore
// we touch every dataset whose DATA or ROW STATE (exclusions, filter) is not
// the same object as before, so the recalc mode applies unchanged: Auto
// recalculates, Manual marks stale, None tracks nothing.
//
// No feedback loop and no lost redo: `touchDataset` and the recalc pass write
// via plain `set` (no `recordHistory`, see store/recalcEngine.ts's contract),
// so a recalc after Undo never pushes an entry or clears `future`.
// Fail closed: a reference difference counts as a change even when the values
// are equal (a spurious recalc is harmless, a missed one shows false "Current").
import type { AnalysisResult } from "../lib/analysisResult";
import { COMMIT_KEY_PARAM, isCommittedOutputResult } from "../lib/committedOutputGraph";
import { markStale } from "../lib/recalc";
import { rowStateIdentity } from "../lib/rowstate";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";

const viewChanged = (a: Dataset, b: Dataset): boolean =>
  rowStateIdentity(a).some((x, i) => x !== rowStateIdentity(b)[i]);

/** Ids present after the restore whose data/row state differs from `before`
 *  (a dataset the restore brought back counts as changed). Unchanged datasets
 *  are never listed. */
export function restoredChangedIds(before: readonly Dataset[], after: readonly Dataset[]): string[] {
  if (before === after) return [];
  const prev = new Map(before.map((d) => [d.id, d]));
  return after.filter((d) => {
    const p = prev.get(d.id);
    return !p || viewChanged(p, d);
  }).map((d) => d.id);
}

/** The committed outputs an undo/redo REPLACED (lane IR): the same result id,
 *  a different commit key (an Undo or Redo of "Open in <tool>" → Replace).
 *  Their session staleness follows the restored envelope: `stale` (an Undo of a
 *  replace of a stale output) marks them, an envelope without it (the replaced,
 *  current computation) clears them. Other results are left alone: their
 *  staleness is session state the envelope does not carry. */
export function replacedOutputs(
  before: readonly AnalysisResult[], after: readonly AnalysisResult[], present: ReadonlySet<string>,
): { stale: string[]; current: string[] } {
  const prev = new Map(before.map((result) => [result.id, result]));
  const stale: string[] = [];
  const current: string[] = [];
  for (const result of after) {
    const old = prev.get(result.id);
    if (!old || old === result || !isCommittedOutputResult(result) ||
        old.parameters?.[COMMIT_KEY_PARAM] === result.parameters?.[COMMIT_KEY_PARAM]) continue;
    const ids = result.outputs.map((ref) => ref.datasetId).filter((id) => present.has(id));
    (result.stale === true ? stale : current).push(...ids);
  }
  return { stale, current };
}

/** Run an undo/redo `restore`, then touch each dataset it changed. A committed
 *  output whose replace was undone or redone takes its restored envelope's
 *  staleness (`staleDatasets` is outside undo; a save + reopen of the same
 *  state derives it from the envelope, so the live session must agree). */
export function restoreTouching(get: () => AppState, restore: () => void, set: (patch: Partial<AppState>) => void): void {
  const before = get().datasets;
  const results = get().analysisResults;
  restore();
  const s = get();
  for (const id of restoredChangedIds(before, s.datasets)) s.touchDataset(id);
  const { stale, current } = replacedOutputs(results, get().analysisResults, new Set(get().datasets.map((d) => d.id)));
  if (stale.length || current.length) {
    const now = get().staleDatasets.filter((id) => !current.includes(id));
    set({ staleDatasets: markStale(now, stale) });
  }
}
