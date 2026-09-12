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

import type { Dataset } from "./types";

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
    if (!Array.isArray(cells)) {
      out[name] = cells;
      continue;
    }
    const sliced = sliceCells(cells, rowIndexes);
    // A column the slice emptied is REMOVED, not kept as `[]`. Keeping it made
    // the key non-empty for no rows, and several readers test only for
    // presence: `columnmeta.hasOriginReportSheets` gates the worksheet's "see
    // Inspector" pointer on `Object.keys(raw).length > 0`,
    // `OriginProvenanceCard` counts it, and `GridHeader` renders an empty
    // read-only column for it. This completes the module's invariant — a sliced
    // column is never longer than it needs to be, and never zero-length either.
    if (sliced.length) out[name] = sliced;
  }
  return out;
}

/** The metadata key a lazily-loaded book's PREVIEW carries its row map under:
 *  for each preview row `r`, WHICH source row it is (`LazyBookEntry.preview_rows`
 *  on the wire -> `preview.metadata.preview_source_rows` on the DataStruct, put
 *  there by `store/importDatasets.ts`). Present whenever the preview's rows do
 *  not already stand one-for-one against the book's: for a SAMPLED preview the
 *  backend sends the map, and for a merely padding-TRIMMED one the importer
 *  SYNTHESIZES the identity map the backend deliberately omits (the trim leaves a
 *  strict PREFIX whose row r IS source row r —
 *  `io/origin_project/preview.py::decimate_with_alignment` — so the wire needs no
 *  map, but a reader with only a length comparison cannot tell that prefix from a
 *  sample, and the identity map is what lets it stop guessing). ABSENT, therefore,
 *  in two cases: a preview that is the whole book (nothing to explain), and a
 *  payload whose `preview_sampled` is missing entirely — an older backend cannot
 *  vouch for the prefix, so its readers keep degrading rather than be handed a
 *  map nobody stands behind.
 *
 *  Deliberately NOT in `ROW_INDEXED_SIDECARS`, and the reasons are worth writing
 *  down because "one rule, one place" is this module's whole point:
 *    * different SHAPE. Those keys hold `{column: [cell per row]}`; this is a
 *      bare `number[]`, which `sliceOneSidecar` returns UNTOUCHED (its
 *      `Array.isArray` rejection). Registering it would buy no slicing at all,
 *      only the false impression that slicing handles it.
 *    * different INDEX SPACE. Those are indexed by SOURCE row; this is indexed
 *      by PREVIEW row and its cells ARE source-row numbers, so a row operation
 *      has to COMPOSE it, not slice it.
 *  What each row operation does with it is therefore stated at that operation,
 *  and stated because the first version of this note instead argued that no
 *  operation could mislabel — while one of them already was:
 *    * `sliceRowSidecars` COMPOSES it and leaves the source-space sidecars alone
 *      (see there). Slicing a source-space column with preview-row indices was
 *      the defect: on the 6-row fixture in `lib/barlayout.test.ts`, faceting by
 *      the text column's own channel captioned the panels correctly and then
 *      labelled the level-2 panel's box `B1`.
 *    * `withoutRowSidecars` DROPS it, so a caller that rebuilds the sidecars in
 *      its own row space (`mergeDatasets`) cannot leave a map from a different
 *      row space standing over them.
 *  A genuinely ROW-INDEXED sidecar added by a parser still belongs in the list
 *  above — this exemption is about this key's shape, not a loosening. */
export const PREVIEW_SOURCE_ROWS = "preview_source_rows";

/** `raw` as a usable preview->source row map, or `null` if it is anything else.
 *
 *  ONE validator, shared by the producer (`store/importDatasets.ts`, against the
 *  wire field) and the consumer (`lib/barlayout.ts`'s label resolution, against
 *  the metadata key), because the two must agree on what counts as usable. A map
 *  that passed the producer and then failed the consumer would be worse than no
 *  map: labels silently absent while a key in the file claims otherwise.
 *
 *  FAILS CLOSED on everything — not an array, a non-integer or negative entry, a
 *  REPEATED entry, a length other than `previewRowCount`, or (when
 *  `sourceRowCount` is given) an entry naming a row the source does not have.
 *  This key round-trips into the `.dwk` (`lib/workspaceSerialize.ts` writes
 *  `d.data` whole), and a `.dwk` is hand-editable, so none of that is
 *  hypothetical.
 *
 *  REPEATS are the one malformation that produces confident WRONG names instead
 *  of degradation, which is why they are rejected rather than tolerated: with
 *  `[0,0,0,0]` every preview row reads source row 0's cell, so the per-level
 *  agreement check in `lib/barlayout.ts` sees no contradiction and every level is
 *  labelled from row 0. Distinctness costs an honest producer nothing — the
 *  sampler builds its index list from `sorted(keep)` over a `set`
 *  (`io/origin_project/preview.py::_decimate`).
 *
 *  ORDER is deliberately NOT required. A reader that only looks up
 *  `sidecar[map[r]]` is correct for ANY permutation, so rejecting an unsorted map
 *  would trade a working label source for a guess about the producer.
 *
 *  `sourceRowCount` bounds the entries, and the two call sites mean different
 *  things by it on purpose: the producer passes `book.rows` — the whole book, the
 *  bound the map is actually about — while the consumer passes NONE, because
 *  there the only number to hand is one text column's cell count and an Origin
 *  text column may legitimately be shorter than the book (`io/origin_project/
 *  opj.py` pads only numeric columns). See `lib/barlayout.ts` for what an entry
 *  past that column's end reads as instead. */
export function asPreviewSourceRows(
  raw: unknown,
  previewRowCount: number,
  sourceRowCount?: number,
): number[] | null {
  if (!Array.isArray(raw) || raw.length !== previewRowCount) return null;
  const bound = sourceRowCount ?? Number.POSITIVE_INFINITY;
  for (const i of raw) {
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= bound) return null;
  }
  if (new Set(raw as number[]).size !== raw.length) return null;
  return raw as number[];
}

/** `map` composed with `rowIndexes`: the preview->source map a row operation's
 *  OUTPUT rows need, given the map its INPUT rows had. Output row k is input row
 *  `rowIndexes[k]`, which is source row `map[rowIndexes[k]]`.
 *
 *  `null` means DROP the map rather than guess. Three ways to get there: the
 *  input is not a usable map at all; an index falls outside it (an
 *  `insertRowIndexes` `-1` blank slot — an inserted row came from no source row,
 *  and there is no honest entry to write for it); or the composed map would not
 *  itself validate, which today means a repeated index (a stack-shaped
 *  `[0,0,1,1]` list) composing to a repeated source row. Re-validating the
 *  OUTPUT is what keeps this module's stored maps and its validator in
 *  agreement: nothing here writes a map that `asPreviewSourceRows` would refuse.
 *
 *  `asPreviewSourceRows` is reused for its ENTRY checks; its LENGTH check is
 *  satisfied trivially on purpose, by passing the map's own length, because a
 *  slice is not told the preview's row count. The load-bearing check is the
 *  `undefined` test in the loop — every index being sliced must land inside the
 *  map — which is the stronger statement anyway. */
function composePreviewSourceRows(
  raw: unknown,
  rowIndexes: readonly number[],
): number[] | null {
  if (!Array.isArray(raw)) return null;
  const map = asPreviewSourceRows(raw, raw.length);
  if (map === null) return null;
  const composed: number[] = [];
  for (const r of rowIndexes) {
    const src = map[r];
    if (src === undefined) return null;
    composed.push(src);
  }
  return asPreviewSourceRows(composed, composed.length);
}

/** A copy of `metadata` with every row-indexed sidecar sliced to `rowIndexes`
 *  and everything else carried through unchanged. Cheap and allocation-free-ish
 *  when the dataset carries no such sidecar, which is the common case.
 *
 *  ONE EXCEPTION, and it is the whole reason this function knows about
 *  `PREVIEW_SOURCE_ROWS`: that key says the sidecars are indexed by SOURCE row
 *  while `rowIndexes` names PREVIEW rows. The two index spaces are not
 *  interchangeable, so the sidecars are left ALONE and the MAP is composed
 *  instead — `map'[k] = map[rowIndexes[k]]`. Slicing a source-space column with
 *  preview-row indices does not produce a smaller version of that column, it
 *  produces different cells: measured on the 6-row book in
 *  `lib/barlayout.test.ts` (levels [0,0,1,1,2,2], text A0,A0,B1,B1,C2,C2,
 *  preview keeping rows [0,2,3,5]), faceting by that column's own channel
 *  captioned the panels correctly and labelled the level-2 panel's box `B1`, and
 *  excluding one row of a 3-row preview turned ["A0","B1"] into ["A0","A0"].
 *  Composition gives both the right labels, and the composed map still describes
 *  exactly the rows it travels with.
 *
 *  A map that cannot be composed is DROPPED (see `composePreviewSourceRows`),
 *  which leaves the source-space sidecars standing with no map — the shape every
 *  reader's length check degrades to numbers. Fail closed, the same posture
 *  `rowsAreSampled` takes. */
export function sliceRowSidecars(
  metadata: Record<string, unknown>,
  rowIndexes: readonly number[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...metadata };
  if (PREVIEW_SOURCE_ROWS in out) {
    const composed = composePreviewSourceRows(out[PREVIEW_SOURCE_ROWS], rowIndexes);
    if (composed === null) delete out[PREVIEW_SOURCE_ROWS];
    else out[PREVIEW_SOURCE_ROWS] = composed;
    return out;
  }
  for (const key of ROW_INDEXED_SIDECARS) {
    if (key in out) out[key] = sliceOneSidecar(out[key], rowIndexes);
  }
  return out;
}

/** May a row-indexed sidecar be indexed against this dataset's numbers at all?
 *  True when those numbers are a SAMPLE, so a row index does not name a real row.
 *
 *  ONE predicate, and it lives here because this module owns the
 *  row-indexed-sidecar contract; a separate module for one function was an extra
 *  eager chunk. Shared, and that is the point: the first version of this fix put
 *  the rule in the worksheet's `textColumns.ts` and a SECOND copy in
 *  `store/cellEdit.ts`'s row-edit guard, which gated on `ds.pending` alone — so one
 *  commit both un-hid a text-only book's columns and made that book permanently
 *  un-editable. A third copy then appeared in
 *  `lib/workspaceDatasetParse.parsePending` and was caught the same day. One rule,
 *  one place.
 *
 *  Reads the backend's own answer (`LazyBookEntry.preview_sampled` ->
 *  `BookSource.previewSampled`), because only the backend can give one.
 *  `io/origin_project/preview.py` runs `_trim_trailing_padding` BEFORE its
 *  `n <= target_points` early return, so a preview can be shorter than the book
 *  while still being a strict PREFIX whose row r IS source row r. Only the
 *  bucketed min/max sampler breaks that correspondence.
 *
 *  Which is why the row-count PROXY tried first — `pending.rows >
 *  data.time.length` — was wrong: it cannot tell a trim from a sample, and the
 *  trim is corpus-attested (Book15 drops 19 of 180 rows). It blanked the text
 *  columns of ordinary books, permanently when the fetch failed, which is exactly
 *  the regression it had been written to remove.
 *
 *  FAILS CLOSED: `undefined` counts as sampled, so a `.dwk` predating the field
 *  or a hand-edited one is treated as unsafe to index rather than assumed fine.
 *  `lib/workspaceDatasetParse.parsePending` applies the same `!== false` rule when
 *  reading it back.
 *
 *  NOT SUPERSEDED by `PREVIEW_SOURCE_ROWS` above, though that map does let ONE
 *  path stop refusing: `lib/barlayout.ts` resolves a category LABEL through
 *  `sidecar[map[r]]`, which is a read whose whole answer is the cell's text. The
 *  ONE caller here — the worksheet grid, `worksheet/textColumns.ts:36`, the only
 *  call site in the tree — stays conservative on purpose, because its rows mean
 *  more than their cells do: mapping the grid's cells would put a real cell on a
 *  row whose neighbours are absent, a grid that looks contiguous and is not.
 *  Mapping a label is recoverable if wrong; mapping a grid is a claim about which
 *  rows exist.
 *
 *  A row EDIT does NOT consult this predicate, and the history paragraph above
 *  says why: the `store/cellEdit.ts` copy was removed. `store/pendingEdit.ts`'s
 *  `refusePendingEdit` refuses every edit on a pending dataset (BUG-009), which
 *  is both stronger and a different question — it does not care whether the
 *  preview was sampled — so `cellEdit.ts` neither imports this nor needs to. */
export function rowsAreSampled(pending: Dataset["pending"]): boolean {
  return pending != null && pending.previewSampled !== false;
}


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
 *  it. Each part contributes EXACTLY `rowCount` cells, padded with `""` — the
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
        for (let r = 0; r < Math.max(0, part.rowCount); r += 1) column.push(cells[r] ?? "");
      }
      if (column.some((cell) => cell !== "")) merged[name] = column;
    }
    if (Object.keys(merged).length) out[key] = merged;
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
