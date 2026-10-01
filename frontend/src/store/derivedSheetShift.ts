// A derived worksheet re-derives from its SOURCE's displayed table, so a column
// the source drops (a removed computed column) drops out of the sheet too and
// every later column shifts down. This carries the sheet's OWN formulas and
// channel-indexed fields across that shift; store/columnRemovalRefs.ts carries
// the references held outside it. Called by `recomputeDerivedSheetTracked`
// (store/derivedWorksheets.ts) on every derived-sheet recalc.

import { remapDatasetChannels } from "../lib/channelRemap";
import { remapSurvivingFormulas } from "../lib/formulaRename";
import type { Dataset } from "../lib/types";

/** The one column `next` lost relative to `prev`, by label order; null when
 *  they match, differ any other way, or the removal is ambiguous (a run of
 *  identical labels — never guess which one went). */
export function singleRemovedColumn(prev: readonly string[], next: readonly string[]): number | null {
  const i = prev.findIndex((label, k) => label !== next[k]);
  const fits = next.length === prev.length - 1 && i >= 0 && next.slice(i).every((label, k) => label === prev[i + k + 1]);
  return fits && prev[i - 1] !== prev[i] ? i : null;
}

/** `sheet` with its formulas and channel-indexed fields shifted past the one
 *  removed base column, or unchanged (`removedCol: null`) for any other change.
 *  DEFECT A's rule (store/computedColumns.ts `removeFormula`): a formula letter
 *  past the removed column shifts with it; a letter AT it becomes an error. */
export function shiftForRemovedColumn(
  sheet: Dataset,
  before: readonly string[],
  after: readonly string[],
): { sheet: Dataset; removedCol: number | null; forcedErrors?: Record<string, string> } {
  const removedCol = singleRemovedColumn(before, after);
  if (removedCol === null) return { sheet, removedCol };
  const { formulas, forcedErrors } = remapSurvivingFormulas(sheet.formulas ?? [], removedCol);
  return {
    sheet: { ...sheet, ...remapDatasetChannels(sheet, removedCol), formulas: formulas.length ? formulas : undefined },
    removedCol,
    forcedErrors: Object.keys(forcedErrors).length ? forcedErrors : undefined,
  };
}
