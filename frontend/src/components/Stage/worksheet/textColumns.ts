// Which text-sheet columns the worksheet grid shows, and how many rows they
// imply. Extracted from useWorksheetView.ts when that file hit its .ts ceiling:
// the pending rule below needs its reasoning written down, and the repo's rule is
// to extract a cohesive sibling rather than shave the explanation to fit.
//
// Cohesive because these two derivations are one question — "what text is in
// this grid, and how far down does it go" — and the second reads the first.

import { originTextColumns, type TextColumn } from "../../../lib/columnmeta";
import type { Dataset } from "../../../lib/types";

/** The text columns to RENDER for `ds` — none while its full data is still
 *  pending (BUG-006 site 9).
 *
 *  A still-pending Origin book's `.time`/`.values` are the ~200-row
 *  min/max-DECIMATED preview (`routes/parsers._book_preview_payload`) while its
 *  `.metadata` is the FULL book's (`_slim_metadata` strips only `origin_books`),
 *  so its text sidecars hold one cell per REAL row — thousands of them. Rendering
 *  them made `GridRow` pair `t.rows[r]` with `values[r]`: two unrelated rows.
 *  Decimation keeps each bucket's extremum, so it is not even a prefix — row r's
 *  text belongs to whatever original row the sampler happened to pick.
 *
 *  `useWorksheetView`'s `pendingGuard` already refuses extract/copy on a pending
 *  dataset for exactly this reason ("a row index computed against the preview
 *  doesn't correspond to any real row"); the RENDER needed the same treatment.
 *
 *  Nothing is lost: `lib/bookData.installBookData` swaps `data` and `metadata`
 *  together, so the columns appear the moment the fetch lands, and the
 *  Inspector's Origin provenance card — which summarizes these sidecars WITHOUT
 *  indexing them by row, so it cannot misalign — keeps showing them throughout. */
export function worksheetTextColumns(ds: Dataset): TextColumn[] {
  return ds.pending ? [] : originTextColumns(ds.data);
}

/** How many rows the text columns cover — the longest one.
 *
 *  Feeds the grid's `max(time.length, textRowCount)` row count, which is why the
 *  pending suppression above matters twice: a pending book's full-length
 *  sidecars would also have inflated the grid to thousands of rows whose numbers
 *  do not exist yet. A text-only book (no numeric rows at all) is the case this
 *  max exists for — there, the text columns ARE the whole grid. */
export function textColumnRowCount(cols: readonly TextColumn[]): number {
  return cols.reduce((max, col) => Math.max(max, col.rows.length), 0);
}
