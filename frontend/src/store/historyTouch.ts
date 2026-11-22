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

/** Run an undo/redo `restore`, then touch each dataset it changed. */
export function restoreTouching(get: () => AppState, restore: () => void): void {
  const before = get().datasets;
  restore();
  const s = get();
  for (const id of restoredChangedIds(before, s.datasets)) s.touchDataset(id);
}
