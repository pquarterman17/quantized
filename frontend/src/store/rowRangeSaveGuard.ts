// A result saved to the Library, or an output worksheet committed, from a tool
// that narrowed its input to a row range would describe rows it did not use:
// a saved result records its inputs as "included rows out of the analysis view"
// and its duplicate key is the source's whole-view fingerprint plus the recipe,
// and neither field can name a range (naming one is a persisted key, which
// plans/ROW_RANGE_CONTRACT.md R0 gates). So those saves FAIL CLOSED while a
// range is set on the source, with the reason; clearing the range (one button
// on the tool's input line) saves as before. A batch run records its rows in the
// existing `rowRuns` key (lib/analysisSelection.analysisSelectionSnapshot) and
// is not affected, and neither is a statistical test (its record counts the
// rows it read). Only producers that read the range are listed: a tool that does
// not narrow (Signal Processing, Curie-Weiss, a transform) saves under a range
// as it always did.

import { rowRangeLabel } from "../lib/rowRange";
import { FIT_MODEL_PRODUCER } from "../lib/fitModelRecipe";
import { TIME_SERIES_RESULT } from "../lib/toolResultKinds";
import { rowRangeOn } from "./analysisSelection";

/** Snapshot results (their tables live in the envelope). */
const RANGED_SNAPSHOT_PRODUCERS: ReadonlySet<string> = new Set([
  "distribution-analysis", "fit-y-by-x", "variability-analysis", "outlier-screening", "multivariate-analysis",
  FIT_MODEL_PRODUCER, TIME_SERIES_RESULT,
]);

/** Committed output worksheets. */
const RANGED_OUTPUT_PRODUCERS: ReadonlySet<string> = new Set([
  "curve-measure", "optical-gap", "spectro-extras", "time-series", "tabulate", "surface-fit", "ellipse-fit",
  "multivar-cluster", "multivar-ext", "km-curve", "row-t-tests", "fit-model-columns",
]);

/** The refusal status line when `producerId` reads a row range set on one of
 *  `sourceIds`, else null. */
export function rowRangeSaveRefusal(producerId: string, sourceIds: readonly string[], what: string): string | null {
  if (!RANGED_SNAPSHOT_PRODUCERS.has(producerId) && !RANGED_OUTPUT_PRODUCERS.has(producerId)) return null;
  for (const id of sourceIds) {
    const range = rowRangeOn(id);
    if (range && range.was === undefined) {
      return `${what} was computed on ${rowRangeLabel(range)} only, and a saved result cannot yet record which rows it used, so nothing was saved. Clear the row range to save it.`;
    }
  }
  return null;
}
