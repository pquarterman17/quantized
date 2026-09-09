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

/** Slice ONE column's cells to `rowIndexes`.
 *
 *  A gap inside the kept range yields `""` — a blank, which is what the
 *  worksheet renders for a missing cell — rather than `undefined`, which would
 *  serialize to `null` and read back as a hole. `??` not `||`, so a legitimate
 *  `0` or empty-string cell survives as itself.
 *
 *  TRAILING misses are dropped instead of materialized. A column shorter than
 *  the grid already reads as blank for the rows it doesn't cover, so padding it
 *  out changes nothing on screen while growing the SAVED dataset on every row
 *  edit — and `insertRows` at the end would otherwise append a blank cell to
 *  every text column forever. This also gives the whole module one checkable
 *  invariant: a sliced column is never longer than it needs to be. */
function sliceCells(cells: readonly unknown[], rowIndexes: readonly number[]): unknown[] {
  const hit = (i: number): boolean => i >= 0 && i < cells.length;
  let end = rowIndexes.length;
  while (end > 0 && !hit(rowIndexes[end - 1])) end -= 1;
  const out: unknown[] = [];
  for (let i = 0; i < end; i += 1) out.push(cells[rowIndexes[i]] ?? "");
  return out;
}

/** Slice one `{column: [cell per row]}` sidecar to `rowIndexes`.
 *
 *  A non-`{name: array}` value is a corrupted sidecar and is returned
 *  UNTOUCHED: without the `Array.isArray` rejection `Object.entries` walks an
 *  array's indices and hands back an object, silently reshaping data we failed
 *  to understand instead of leaving it alone. */
function sliceOneSidecar(raw: unknown, rowIndexes: readonly number[]): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [name, cells] of Object.entries(raw as Record<string, unknown>)) {
    out[name] = Array.isArray(cells) ? sliceCells(cells, rowIndexes) : cells;
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

/** How many rows the sidecars in `metadata` actually span, given a grid of
 *  `rowCount` rows — `max(rowCount, longest sidecar column)`.
 *
 *  A sidecar CAN be longer than `time`, and sizing an index list from
 *  `time.length` alone silently TRUNCATES the excess on the next row edit. That
 *  is not misattribution, it is destruction: a text-only Origin book imports as
 *  `time: []` with a populated `text_columns`, so a single `insertRows` sized
 *  from `time.length` would have persisted an empty grid over the whole
 *  worksheet. Callers that build an index list for a PERSISTED edit must size
 *  it from here; a read-only slice (Extract, Split, a filter view) may keep
 *  using the grid's own row count because it discards rows either way. */
export function sidecarRowCount(metadata: Record<string, unknown>, rowCount: number): number {
  let n = rowCount;
  for (const key of ROW_INDEXED_SIDECARS) {
    const raw = metadata[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    for (const cells of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(cells) && cells.length > n) n = cells.length;
    }
  }
  return n;
}

/** An index list that turns a row INSERT into a slice: the rows before `at`,
 *  then `count` slots that resolve to blanks, then the rest. `-1` never indexes
 *  a real cell, and `sliceCells` already yields `""` for a miss, so an insert
 *  needs no separate code path — which is the point, since the two must not
 *  drift.
 *
 *  `at`/`count` are TRUNCATED toward zero and `at` is clamped to `[0,
 *  rowCount]`, matching what the numeric insert does with the same arguments:
 *  `values.slice(0, 1.5)` keeps one row, so a `1.5` left un-truncated here
 *  produced a list of length `rowCount + count` whose entries no longer lined
 *  up with the grid at all (`[0, -1, 1.5]` — index `1.5` is a miss). The
 *  returned length is always `rowCount + max(0, trunc(count))`. */
export function insertRowIndexes(rowCount: number, at: number, count: number): number[] {
  const n = Math.max(0, Math.trunc(count) || 0); // `|| 0` catches NaN, whose Array.from length is 0 anyway
  const clamped = Math.max(0, Math.min(Math.trunc(at) || 0, rowCount));
  return [
    ...Array.from({ length: clamped }, (_, i) => i),
    ...Array.from({ length: n }, () => -1),
    ...Array.from({ length: rowCount - clamped }, (_, i) => clamped + i),
  ];
}
