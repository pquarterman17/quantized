// Which text-sheet columns the worksheet grid shows, and how many rows they
// imply. Extracted from useWorksheetView.ts when that file hit its .ts ceiling:
// the pending rule below needs its reasoning written down, and the repo's rule is
// to extract a cohesive sibling rather than shave the explanation to fit.
//
// Cohesive because these two derivations are one question — "what text is in
// this grid, and how far down does it go" — and the second reads the first.

import { originTextColumns, type TextColumn } from "../../../lib/columnmeta";
import type { Dataset } from "../../../lib/types";

/** The text columns to RENDER for `ds` — suppressed only while a pending book's
 *  numbers are a DECIMATED sample of its text (BUG-006 site 9).
 *
 *  A still-pending Origin book's `.time`/`.values` come from the preview
 *  (`routes/parsers._book_preview_payload`) while its `.metadata` is the FULL
 *  book's (`_slim_metadata` strips only `origin_books`), so its text sidecars can
 *  hold one cell per REAL row. Rendering those made `GridRow` pair `t.rows[r]`
 *  with `values[r]`: two unrelated rows. Decimation keeps each bucket's extremum,
 *  so it is not even a prefix — row r's text belongs to whatever original row the
 *  sampler picked. Same ruling as `useWorksheetView`'s `pendingGuard` on
 *  extract/copy: a row index against the preview does not name a real row.
 *
 *  NOT `ds.pending` alone, which was the first version and over-suppressed badly.
 *  `io/origin_project/preview.decimate_datastruct` returns its input UNCHANGED
 *  when the book has at most `target_points` (200) rows or no channels at all —
 *  so for a small book, and for every TEXT-ONLY book, the "preview" IS the full
 *  data and its sidecars are exactly aligned. Blanking those cost the user their
 *  whole worksheet: a text-only book (`time: []`, where the text columns ARE the
 *  grid — the case `useWorksheetView`'s `max(time.length, textRowCount)` exists
 *  for) rendered EMPTY while pending, and permanently so when the fetch fails,
 *  since `installBookData`'s catch leaves `pending` set.
 *
 *  So the condition is the actual mismatch: `pending.rows` (the full book's row
 *  count, straight from the wire entry) exceeding the numbers we hold. That is
 *  true exactly when decimation dropped rows, and false whenever the preview is
 *  the real thing.
 *
 *  Nothing is lost even when it does fire: `lib/bookData.installBookData` swaps
 *  `data` and `metadata` together, so the columns appear the moment the fetch
 *  lands, and the Inspector's Origin provenance card — which summarizes these
 *  sidecars WITHOUT indexing them by row, so it cannot misalign — keeps showing
 *  them throughout. */
export function worksheetTextColumns(
  data: Dataset["data"],
  pending: Dataset["pending"],
): TextColumn[] {
  // Takes the two FIELDS rather than the Dataset so its `useMemo` deps can be
  // exactly `[ds.data, ds.pending]` — keying the memo on the whole Dataset made
  // `react-hooks/exhaustive-deps` demand `ds` and re-materialize every text cell
  // on any unrelated Dataset change (a rename, a tag, an exclusion toggle).
  const decimated = pending != null && (pending.rows ?? 0) > data.time.length;
  return decimated ? [] : originTextColumns(data);
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
