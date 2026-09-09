// The pure half of the worksheet's Extract action (`useWorksheetView`'s
// `extractSubset`): turn a set of analysis row indices into a valid child
// DataStruct, or refuse.
//
// Extracted into its own module because the row-index domain here is subtler
// than it looks and the reasoning does not belong buried in a 650-line hook.
// The worksheet's row indices run over max(NUMERIC rows, TEXT rows) — an Origin
// book can carry more inline-text rows than numeric ones, and a text-only book
// has `time.length === 0` with the text columns as the whole grid
// (`lib/columnmeta.ts`'s `TextColumn` doc). So an analysis row index can point
// PAST `values`, at a row with no numeric content for a DataStruct to hold.
//
// Extract used to build its child by hand and index `values[r]` unguarded,
// storing `undefined` for such a row — silent corruption, and the reason
// `useWorksheetView`'s stats subset already writes `values[r]?.[c]`. Clamping
// is what keeps the result a valid DataStruct.
//
// NOT solved here, deliberately: the `text_columns` metadata sidecar is carried
// through UNSLICED by `sliceDataStruct` (it copies `metadata` wholesale), so an
// extract from a text-bearing sheet gets text cells that no longer line up with
// its rows. That is a shared `sliceDataStruct` concern (Split-by-column has the
// same exposure) and is tracked as BUG-006, not papered over here.

import { sliceDataStruct } from "../../../lib/datasetsplit";
import type { DataStruct } from "../../../lib/types";

export interface ExtractPlan {
  /** The child dataset's data — a row slice, so column layout (and therefore
   *  `cat_levels`) is unchanged. */
  data: DataStruct;
  /** How many rows the child actually holds. */
  extracted: number;
  /** Analysis rows left behind because they carry no numeric data. */
  skipped: number;
}

/** Plan an Extract, or `null` when none of the requested rows carry numeric
 *  data (a text-only selection has nothing a DataStruct can represent). */
export function planExtract(data: DataStruct, analysisRows: readonly number[]): ExtractPlan | null {
  const numericRows = analysisRows.filter((r) => r < data.values.length);
  if (numericRows.length === 0) return null;
  return {
    data: sliceDataStruct(data, numericRows),
    extracted: numericRows.length,
    skipped: analysisRows.length - numericRows.length,
  };
}

/** The status line for an Extract attempt — including a refused one, so the
 *  caller has exactly one thing to say either way. Names the rows left behind
 *  rather than quietly reporting a smaller total than the user selected. */
export function describeExtract(plan: ExtractPlan | null, totalRows: number): string {
  if (!plan) return "nothing to extract — the selected rows carry no numeric data";
  const tail =
    plan.skipped > 0
      ? ` (${plan.skipped} text-only row${plan.skipped === 1 ? "" : "s"} have no numeric data)`
      : "";
  return `extracted ${plan.extracted} of ${totalRows} rows${tail}`;
}
