// The lazy-only half of lib/rowSidecars.ts (bundle diet slice 16): the
// sidecar strip and row-concatenation an append/merge rebuilds with. Only
// the lazy lib/merge.ts calls these, while the eager
// store needs the slice, count and insert helpers, so the code moved here
// verbatim and lib/rowSidecars.ts re-exports it with `export *` - importers
// are unchanged, and Rollup bundles this file with the lazy chunks that use
// it. architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import { PREVIEW_SOURCE_ROWS, ROW_INDEXED_SIDECARS } from "./rowSidecars";

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
