// Legacy `null` DataStruct cells on .dwk load (owner ruling 2026-10-03,
// reversing BUG-017's "a pre-fix null cell stays a rejection"). A save made
// before PR #527 wrote NaN, ±Infinity and a missing import cell all as JSON
// `null`. Such a cell is now read as NaN (missing) and tallied for ONE
// migration warning; the original non-finite identity is unrecoverable, and
// the next save writes the "NaN" sentinel. Only a CELL inside a `time` array or
// a `values` row is read this way: a null row, null `time`/`values`, any other
// string, `undefined` and every other structural fault still fail the reader's
// check exactly as before. Lazy-only (imported by the .dwk parse path), so
// none of this ships in the entry chunk.

import { decodeWireRow } from "./nonFiniteCells";

/** Legacy null cells read during one workspace parse. */
export interface LegacyNullTally {
  cells: number;
  /** Where they were found, as display labels (`"run-a.csv"`, `report "Figs"`). */
  names: string[];
}

/** `v` with each `null` cell read as NaN, counted into `tally`. Returns `v`
 *  itself when it is not an array or holds no null. */
export function readLegacyNullCells(v: unknown, tally: { cells: number }): unknown {
  if (!Array.isArray(v) || !v.includes(null)) return v;
  return v.map((cell: unknown) => {
    if (cell !== null) return cell;
    tally.cells++;
    return Number.NaN;
  });
}

/** A serialized DataStruct-shaped object with its legacy null cells read as
 *  NaN (`time` and each `values` row). Returns `v` itself when none. */
export function readLegacyNullStruct(v: unknown, tally: { cells: number }): unknown {
  if (typeof v !== "object" || v === null) return v;
  const o = v as Record<string, unknown>;
  const before = tally.cells;
  const time = readLegacyNullCells(o.time, tally);
  const values = Array.isArray(o.values) ? o.values.map((row) => readLegacyNullCells(row, tally)) : o.values;
  return tally.cells === before ? v : { ...o, time, values };
}

/** `decodeWireRow` with a legacy null read as NaN. The row is all-or-nothing:
 *  its nulls are counted into `tally` only when the WHOLE row decodes. */
export function decodeLegacyWireRow(v: unknown, tally: { cells: number }): ReturnType<typeof decodeWireRow> {
  const local = { cells: 0 };
  const r = decodeWireRow(readLegacyNullCells(v, local));
  if (!r.ok) return { value: v, changed: false, ok: false };
  tally.cells += local.cells;
  return local.cells ? { ...r, changed: true } : r;
}

/** Record `label` in `tally` when cells were added since `before`. */
export function noteLegacyNulls(tally: LegacyNullTally, before: number, label: string): void {
  if (tally.cells > before && !tally.names.includes(label)) tally.names.push(label);
}

/** The one-sentence migration warning for `tally`, or null when it is empty.
 *  Names are listed only when short (at most three, 60 characters). */
export function legacyNullWarning({ cells, names }: LegacyNullTally): string | null {
  if (!cells) return null;
  const list = names.join(", ");
  const where = names.length <= 3 && list.length <= 60 ? ` in ${list}` : "";
  const what = cells === 1 ? "1 cell" : `${cells} cells`;
  const verb = cells === 1 ? "was read as a missing value" : "were read as missing values";
  return `${what} saved as blank by an older version ${verb}${where}.`;
}
