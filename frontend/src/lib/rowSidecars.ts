// Row-indexed metadata sidecars, and the one place that knows which keys those
// are (BUG-006).
//
// Most of `DataStruct.metadata` is structural or file-level and survives a row
// operation untouched. THREE keys are not: they hold one cell per ROW, so any
// operation that keeps a subset of rows has to keep the same subset of their
// cells or every cell describes a different measurement than the one beside it.
// A sample id, an operator, an Origin report reference — read against the wrong
// row, silently.
//
// Its own module rather than a helper inside `lib/datasetsplit.ts` for a
// concrete reason: `datasetsplit` is ~3.5 kB of splitting math that is
// deliberately LAZY (see `store/split.ts`), while two of the three callers here
// (`lib/rowstate.pruneExcluded`, `lib/facet.facetSlices`) are eager. Importing
// the big module to reach a small helper would drag it all back into the eager
// bundle.
//
// The keys are ENUMERATED, not inferred. "Slice anything shaped like
// `{name: array}`" would also hit the channel-indexed collections and be the
// mirror-image bug: `label_rows`' `cells` are per-CHANNEL, `all_column_names`
// is the column roster, `comments`/`source` are file-level. Adding a row-indexed
// sidecar to a parser means adding it here too.

/** `text_columns` and `origin_text_columns` are the two spellings of the
 *  inline-text sidecar (`lib/columnmeta.ts` reads `text_columns ??
 *  origin_text_columns`). `origin_report_sheets` is the same
 *  `{name: [cell per row]}` shape — Origin report-sheet reference strings
 *  (`io/origin_project/opj.py`) — and was missed by the first version of this
 *  fix, which asserted in its own comment that nothing else was row-indexed. */
export const ROW_INDEXED_SIDECARS = [
  "text_columns",
  "origin_text_columns",
  "origin_report_sheets",
] as const;

/** Slice one `{column: [cell per row]}` sidecar to `rowIndexes`.
 *
 *  A cell past the end yields `""` — a blank, which is what the worksheet
 *  renders for a missing one — rather than `undefined`, which would serialize
 *  to `null` and read back as a hole. `??` not `||`, so a legitimate `0` or
 *  empty-string cell survives as itself.
 *
 *  A non-`{name: array}` value is a corrupted sidecar and is returned
 *  UNTOUCHED: without the `Array.isArray` rejection `Object.entries` walks an
 *  array's indices and hands back an object, silently reshaping data we failed
 *  to understand instead of leaving it alone. */
function sliceOneSidecar(raw: unknown, rowIndexes: readonly number[]): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [name, cells] of Object.entries(raw as Record<string, unknown>)) {
    out[name] = Array.isArray(cells) ? rowIndexes.map((i) => cells[i] ?? "") : cells;
  }
  return out;
}

/** A copy of `metadata` with every row-indexed sidecar sliced to `rowIndexes`
 *  and everything else carried through unchanged. Cheap and allocation-free-ish
 *  when the dataset carries no such sidecar, which is the common case. */
export function sliceRowSidecars(
  metadata: Record<string, unknown>,
  rowIndexes: readonly number[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...metadata };
  for (const key of ROW_INDEXED_SIDECARS) {
    if (key in out) out[key] = sliceOneSidecar(out[key], rowIndexes);
  }
  return out;
}
