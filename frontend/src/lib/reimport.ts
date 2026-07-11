// Pure helpers for MAIN_PLAN #10 (re-import a dataset from its source file —
// Origin's "Re-import Directly": a measurement re-runs, the instrument
// rewrites the same file, one click refreshes the dataset in place). Kept out
// of the store (`store/reimport.ts` is the thin orchestrator) so the book-
// matching and shape-change detection are unit-testable without a store
// instance, matching lib/dataset.ts's convention.

import { fetchBookData } from "./api";
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
 *  so, every row/column-indexed field (excludedRows, filter, channelRoles,
 *  channelTypes, formulas) is stale — indices into a shape that no longer
 *  exists — and must clear rather than silently point at the wrong rows or
 *  columns. Mirrors the existing xTrim (`applyCorrections`'s `rowsChanged`)
 *  and `installBookData`'s preview->full-swap precedents. */
export function reimportShapeChanged(ds: Dataset, fresh: DataStruct): boolean {
  const baseCols = Math.max(0, ds.data.labels.length - (ds.formulas?.length ?? 0));
  return fresh.time.length !== ds.data.time.length || fresh.labels.length !== baseCols;
}
