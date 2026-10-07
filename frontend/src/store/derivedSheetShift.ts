// A derived worksheet re-derives from its SOURCE's displayed table, so a column
// the source drops (a removed computed column) drops out of the sheet too and
// every later column shifts down; a column it GAINS (an added formula, a
// column-changing reimport) shifts every later one — the sheet's own formula
// columns included — up. This carries the sheet's OWN formulas and
// channel-indexed fields across that shift; store/columnRemovalRefs.ts carries
// the references held outside it. Called by `recomputeDerivedSheet`
// (store/derivedWorksheets.ts) on every derived-sheet recalc.

import { type ColumnShift, remapDatasetChannels } from "../lib/channelRemap";
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

/** The single removal or insertion (by label, the same refuse-to-guess rule
 *  mirrored for an insert) turning `before` into `after`, else null. */
export function detectColumnShift(before: readonly string[], after: readonly string[]): ColumnShift | null {
  const inserted = singleRemovedColumn(after, before);
  return inserted !== null ? { inserted } : singleRemovedColumn(before, after);
}

/** `sheet` with its formulas and channel-indexed fields shifted past the one
 *  removed or inserted base column, or unchanged (`shift: null`) for any other
 *  change. DEFECT A's rule (store/computedColumns.ts `removeFormula`): a
 *  formula letter past the removed column shifts with it; a letter AT it
 *  becomes an error. An insertion moves every letter at or past it up one. */
export function shiftForColumnChange(
  sheet: Dataset,
  before: readonly string[],
  after: readonly string[],
): { sheet: Dataset; shift: ColumnShift | null; forcedErrors?: Record<string, string> } {
  const shift = detectColumnShift(before, after);
  if (shift === null) return { sheet, shift };
  const { formulas, forcedErrors } = remapSurvivingFormulas(sheet.formulas ?? [], shift);
  return {
    sheet: { ...sheet, ...remapDatasetChannels(sheet, shift), formulas: formulas.length ? formulas : undefined },
    shift,
    forcedErrors: Object.keys(forcedErrors).length ? forcedErrors : undefined,
  };
}
