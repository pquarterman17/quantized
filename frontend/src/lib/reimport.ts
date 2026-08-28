// Pure helpers for MAIN_PLAN #10 (re-import a dataset from its source file —
// Origin's "Re-import Directly": a measurement re-runs, the instrument
// rewrites the same file, one click refreshes the dataset in place). Kept out
// of the store (`store/reimport.ts` is the thin orchestrator) so the book-
// matching and shape-change detection are unit-testable without a store
// instance, matching lib/dataset.ts's convention.

import { fetchBookData } from "./api";
import { columnMetaList } from "./columnmeta";
import { isLazyBookEntry, isPrimaryBookMarker } from "./types";
import type { BookSource, DataStruct, Dataset, LazyBookEntry, PrimaryBookMarker } from "./types";

/** The Origin book id `ds` was imported from (`metadata.origin_book`), or
 *  null for a non-Origin / single-book import — the same field the backend
 *  stamps every book with (`routes/parsers.py`'s `_origin_book_id`). */
export function datasetBookId(ds: Dataset): string | null {
  const raw = (ds.data.metadata as Record<string, unknown> | undefined)?.origin_book;
  return typeof raw === "string" && raw ? raw : null;
}

/** Find `bookId`'s entry in a freshly re-read file's `books[]` (a re-import
 *  never requests the `full_books` escape hatch, so every real entry is a
 *  marker/preview, never an inline DataStruct — narrowed accordingly). */
export function findBook(
  fresh: DataStruct,
  bookId: string,
): PrimaryBookMarker | LazyBookEntry | undefined {
  return fresh.books?.filter(
    (b): b is PrimaryBookMarker | LazyBookEntry => isPrimaryBookMarker(b) || isLazyBookEntry(b),
  ).find((b) => b.id === bookId);
}

/** The bare DataStruct fields (drops `.books`/`.book_source`/`.figures` —
 *  incidental to a re-read, never part of a Dataset's own `.data`). */
function core(d: DataStruct, labels = d.labels, units = d.units, metadata = d.metadata): DataStruct {
  return { time: d.time, values: d.values, labels, units, metadata };
}

/** The ONE real DataStruct a re-import should install for `ds`: match its
 *  Origin book (if any) inside the freshly re-read `fresh` payload, fetching
 *  a lazy book's full data on demand; falls back to `fresh`'s own top-level
 *  data for a non-book / single-book file. Throws (never returns a wrong
 *  book's data) if `ds` WAS a specific book that no longer exists in the
 *  refreshed file, or the refreshed file lost its book-source reference. */
export async function resolveFreshData(ds: Dataset, fresh: DataStruct): Promise<DataStruct> {
  const bookId = datasetBookId(ds);
  if (bookId == null || !fresh.books?.length) return core(fresh);
  const book = findBook(fresh, bookId);
  if (!book) throw new Error(`book "${bookId}" no longer exists in the re-imported file`);
  if (isPrimaryBookMarker(book)) return core(fresh, book.labels, book.units, book.metadata);
  if (!fresh.book_source) throw new Error("re-imported file is missing its book source reference");
  const src: BookSource = { ...fresh.book_source, bookId: book.id, rows: book.rows, cols: book.cols };
  return fetchBookData(src);
}

/** Does the fresh data's shape (rows or BASE columns, i.e. excluding
 *  `ds`'s own computed formula columns) differ from `ds`'s CURRENT data? If
 *  so, the ROW-indexed `excludedRows` is stale — indices into rows that no
 *  longer exist — and must clear rather than silently point at the wrong
 *  rows. (The COLUMN-indexed fields — filter/channelRoles/channelTypes/
 *  formulas/errorRoles — clear on the narrower `reimportColumnsChanged`
 *  alone; see that function's doc.) Mirrors the existing xTrim
 *  (`applyCorrections`'s `rowsChanged`) and `installBookData`'s
 *  preview->full-swap precedents. */
export function reimportShapeChanged(ds: Dataset, fresh: DataStruct): boolean {
  return fresh.time.length !== ds.data.time.length || reimportColumnsChanged(ds, fresh);
}

/** The COLUMN half of `reimportShapeChanged` alone. Every column-indexed
 *  field — filter/channelRoles/channelTypes/formulas/errorRoles — stays
 *  provably valid across a row-only reshape (column meaning is untouched),
 *  so `commitReimport` clears them, and disturbs a saved editable figure's
 *  channel bindings, only on this narrower condition — unlike the live
 *  view/window reset, which fires on any shape change because the user is
 *  actively looking at it.
 *
 *  SILENT_STATE_CORRUPTION_PLAN #5: a bare column-COUNT comparison passes a
 *  file whose column MEANING changed while the count did not (a re-
 *  designated Origin export, a reordered export) — every column-indexed
 *  field above then keeps describing columns that no longer match. The
 *  identity signal used here, in order:
 *   1. Column COUNT (unchanged from before) — still the fast rejection for
 *      the common grow/shrink case.
 *   2. Label SEQUENCE, positional: `ds.data`'s BASE labels (the same
 *      formula-column exclusion the count check already applied) compared
 *      index-by-index against `fresh.labels`. A reorder or a rename of any
 *      base column is "changed" — deliberately conservative: an honest
 *      "changed" (which only resets bindings, never deletes data — see
 *      `figureDocumentReimport.ts`'s module doc) beats a silent stale
 *      mapping. This is NOT fuzzy matching; a straight rename is a mismatch
 *      by design.
 *   3. Origin column DESIGNATION, positional, but ONLY when BOTH `ds.data`
 *      and `fresh` carry designation metadata (`columnMetaList` — the
 *      shared `origin_column_names` + `column_designations` alignment,
 *      lib/columnmeta.ts). A re-designation in Origin (same short names,
 *      same order, different X/Y/Y-error/... role) leaves the label
 *      sequence untouched, so it needs its own check. When only one side
 *      (or neither) carries designations, this step is skipped rather than
 *      treating "no data" as "mismatch" — the label check above is already
 *      the honest signal in that case. */
export function reimportColumnsChanged(ds: Dataset, fresh: DataStruct): boolean {
  const baseCols = Math.max(0, ds.data.labels.length - (ds.formulas?.length ?? 0));
  if (fresh.labels.length !== baseCols) return true;

  const baseLabels = ds.data.labels.slice(0, baseCols);
  for (let i = 0; i < baseCols; i++) {
    if (baseLabels[i] !== fresh.labels[i]) return true;
  }

  const baseMeta = columnMetaList(ds.data);
  const freshMeta = columnMetaList(fresh);
  if (baseMeta.length === 0 || freshMeta.length === 0) return false;
  for (let i = 0; i < baseCols; i++) {
    if (baseMeta[i]?.designation !== freshMeta[i]?.designation) return true;
  }
  return false;
}
