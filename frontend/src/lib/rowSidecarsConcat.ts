// The lazy-only half of lib/rowSidecars.ts (bundle diet slice 16): the
// sidecar strip and row-concatenation an append/merge rebuilds with. Only
// the lazy lib/merge.ts calls these, while the eager
// store needs the slice, count and insert helpers, so the code moved here
// verbatim and lib/rowSidecars.ts re-exports it with `export *` - importers
// are unchanged, and Rollup bundles this file with the lazy chunks that use
// it. architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import { CELL_NOTES_KEY, FIT_ROW_IDENTITIES, PREVIEW_SOURCE_ROWS, ROW_INDEXED_SIDECARS, sidecarBlank } from "./rowSidecars";

/** A copy of `metadata` with every row-indexed sidecar key REMOVED — and
 *  `PREVIEW_SOURCE_ROWS` with them.
 *
 *  For a caller that is about to REBUILD them (merge) or that has no rows to
 *  describe. `concatRowSidecars` omits a key no input contributes a cell for, so
 *  a spread-then-overwrite left the old sidecar standing in exactly that case —
 *  strip first, then add back what the rebuild produced.
 *
 *  The preview->source map goes too, because a rebuild happens in the CALLER's
 *  row space and that map is about someone else's: `mergeDatasets` inherits
 *  dataset 0's non-row-indexed metadata wholesale, so without this a merged grid
 *  could carry dataset 0's map over freshly concatenated row-space sidecars.
 *  `concatRowSidecars` emits every column at exactly the summed span, so today a
 *  reader's length check would not consult that map anyway — stripping it is what
 *  makes the safety a property of this module instead of an accident of the
 *  merge's arithmetic. */
export function withoutRowSidecars(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...metadata };
  for (const key of ROW_INDEXED_SIDECARS) delete out[key];
  delete out[PREVIEW_SOURCE_ROWS];
  delete out[FIT_ROW_IDENTITIES];
  delete out[CELL_NOTES_KEY]; // rebuilt by `concatRowSidecars`, which offsets each part's notes
  return out;
}

/** One input to `concatRowSidecars`: a dataset's metadata and how many rows it
 *  contributes to the combined grid. */
export interface SidecarPart {
  metadata: Record<string, unknown>;
  rowCount: number;
}

/** Row-CONCATENATION of several datasets' sidecars, for an append/merge
 *  (BUG-006 site 8).
 *
 *  `lib/merge.ts` used to carry `{...datasets[0].metadata}` verbatim, which did
 *  two wrong things at once: datasets 1..N's sidecars were silently DROPPED, and
 *  if dataset 0's sidecar ran longer than its own row count its trailing cells
 *  landed on dataset 1's rows.
 *
 *  Column names are UNIONED in first-appearance order, so a text column present
 *  in only some inputs survives, blank for the rows of the datasets that lack
 *  it. Each part contributes EXACTLY `rowCount` cells, padded with the key's
 *  blank (`sidecarBlank`: `""`, or `null` for the imaginary parts) — the
 *  blanks are real (those rows genuinely have no cell), and exact-length parts
 *  are what keeps every later cell aligned with its own row. This is the one
 *  place that does NOT trailing-trim: trimming a part would shift every
 *  following part by however much it trimmed. A column that ends up blank for
 *  every row is dropped, since several readers gate on a key's presence alone.
 *
 *  `rowCount` is the caller's per-part SPAN, not its `time.length`. An earlier
 *  version took `time.length` and called the resulting truncation "the honest
 *  trade" — it was neither honest nor necessary: `store/cellEdit.ts` had already
 *  ruled that a sidecar may run longer than the numeric grid and that sizing
 *  from `time.length` destroys the excess. `mergeDatasets` now pads each part's
 *  numeric rows out to the same span, so nothing is dropped and part k's numbers
 *  and text land on the same output rows. */
export function concatRowSidecars(parts: readonly SidecarPart[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ROW_INDEXED_SIDECARS) {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const raw = part.metadata[key];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      for (const name of Object.keys(raw)) {
        if (!seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      }
    }
    if (!names.length) continue;
    const blank = sidecarBlank(key);
    const merged: Record<string, unknown[]> = {};
    for (const name of names) {
      const column: unknown[] = [];
      for (const part of parts) {
        const raw = part.metadata[key];
        const map =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
        const cells = Array.isArray(map[name]) ? (map[name] as unknown[]) : [];
        for (let r = 0; r < Math.max(0, part.rowCount); r += 1) column.push(cells[r] ?? blank);
      }
      if (column.some((cell) => cell !== blank)) merged[name] = column;
    }
    if (Object.keys(merged).length) out[key] = merged;
  }
  // Cell notes are sparse `{col: {row: text}}`: each part's rows move by the rows before it. Columns stay as they
  // are (a merge keeps the first dataset's column layout and refuses a different column count).
  const notes: Record<string, Record<string, string>> = {};
  let offset = 0;
  for (const part of parts) {
    for (const [col, rows] of Object.entries(Object(part.metadata[CELL_NOTES_KEY]))) {
      for (const [row, text] of Object.entries(Object(rows))) {
        if (typeof text === "string" && text && Number(row) < part.rowCount) (notes[col] ??= {})[String(offset + Number(row))] = text;
      }
    }
    offset += Math.max(0, part.rowCount);
  }
  if (Object.keys(notes).length) out[CELL_NOTES_KEY] = notes;
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
 *  rowCount]`, matching what the numeric insert does with the same arguments
 *  (`values.slice(0, 1.5)` keeps one row). Un-truncated, `at = 1.5` produced
 *  `[0, -1, 1.5]` — one entry short of the grid, with an index that hits no
 *  cell. This is HARDENING, not a bug that was firing: the only caller passes
 *  integer selection indices, and the `qz.insertRows(...)` macro text has no
 *  interpreter today. It earns its place for the day one does. The returned
 *  length is always `rowCount + max(0, trunc(count))`. */
export function insertRowIndexes(rowCount: number, at: number, count: number): number[] {
  const n = Math.max(0, Math.trunc(count) || 0); // `|| 0` catches NaN, whose Array.from length is 0 anyway
  const clamped = Math.max(0, Math.min(Math.trunc(at) || 0, rowCount));
  return [
    ...Array.from({ length: clamped }, (_, i) => i),
    ...Array.from({ length: n }, () => -1),
    ...Array.from({ length: rowCount - clamped }, (_, i) => clamped + i),
  ];
}
