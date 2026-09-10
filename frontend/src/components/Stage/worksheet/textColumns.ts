// Which text-sheet columns the worksheet grid shows, and how many rows they
// imply. Extracted from useWorksheetView.ts when that file hit its .ts ceiling:
// the pending rule below needs its reasoning written down, and the repo's rule is
// to extract a cohesive sibling rather than shave the explanation to fit.
//
// Cohesive because these two derivations are one question — "what text is in
// this grid, and how far down does it go" — and the second reads the first.

import { originTextColumns, type TextColumn } from "../../../lib/columnmeta";
import { rowsAreSampled } from "../../../lib/rowSidecars";
import type { Dataset } from "../../../lib/types";

/** The text columns to RENDER — none when the numbers are a sample.
 *
 *  A still-pending Origin book's `.time`/`.values` come from the preview while its
 *  `.metadata` is the FULL book's (`_slim_metadata` strips only `origin_books`),
 *  so its text sidecars can hold one cell per REAL row. Rendering those made
 *  `GridRow` pair `t.rows[r]` with `values[r]`: two unrelated rows, since the
 *  sampler keeps each bucket's extremum rather than a prefix. Same ruling as
 *  `useWorksheetView`'s `pendingGuard` on extract/copy — a row index against a
 *  sample does not name a real row.
 *
 *  Nothing is lost: `lib/bookData.installBookData` swaps `data` and `metadata`
 *  together, so the columns appear the moment the fetch lands, and the Inspector's
 *  Origin provenance card — which summarizes these sidecars WITHOUT indexing them
 *  by row, so it cannot misalign — keeps showing them throughout.
 *
 *  Takes the two FIELDS rather than the Dataset so its `useMemo` deps can be
 *  exactly `[ds.data, ds.pending]`; keying on the whole Dataset made
 *  `react-hooks/exhaustive-deps` demand `ds` and re-materialize every text cell on
 *  any unrelated change (a rename, a tag, an exclusion toggle). */
export function worksheetTextColumns(
  data: Dataset["data"],
  pending: Dataset["pending"],
): TextColumn[] {
  return rowsAreSampled(pending) ? [] : originTextColumns(data);
}

export function textColumnRowCount(cols: readonly TextColumn[]): number {
  return cols.reduce((max, col) => Math.max(max, col.rows.length), 0);
}
