// Cell notes (plans/ROW_RANGE_CONTRACT.md section 7): free text on one worksheet cell.
//
// Stored as a row-indexed sidecar under the private metadata key `CELL_NOTES_KEY`
// (`lib/rowSidecars.ts`), shaped `{ [col]: { [row]: text } }`: sparse, `col` a channel index (-1 is X),
// `row` a SOURCE row (a worksheet row, never a position in a sorted or filtered view). Rows follow the one
// slicer (`sliceRowSidecars`: sort, insert, delete, Extract, split, facet, the exclusion prune), columns follow
// `remapDatasetChannels`, so no row or column operation has a call site of its own for notes.
//
// This module is pure and lazy-only: the eager halves (the slice and the column remap) live beside the
// code they extend. A note's text is data, never markup: every consumer renders it as plain text.

import { CELL_NOTES_KEY } from "./rowSidecars";

export { CELL_NOTES_KEY };

/** `{ [col]: { [row]: text } }` as stored (JSON object keys are strings). */
export type CellNotes = Record<string, Record<string, string>>;

/** Characters per note, and notes per sheet (contract 7.1). Beyond either the edit is refused with a reason. */
export const MAX_NOTE_CHARS = 2000;
export const MAX_NOTES = 2000;

/** The sidecar read defensively: a hand-edited `.dwk` may hold anything, and only well-formed entries count. */
export function notesOf(metadata: Record<string, unknown> | undefined): CellNotes {
  const raw = metadata?.[CELL_NOTES_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CellNotes = {};
  for (const [col, rows] of Object.entries(raw)) {
    if (!rows || typeof rows !== "object" || Array.isArray(rows)) continue;
    for (const [row, text] of Object.entries(rows)) {
      if (typeof text === "string" && text !== "") (out[col] ??= {})[row] = text;
    }
  }
  return out;
}

/** The note on (`row`, `col`), or undefined. */
export function noteAt(metadata: Record<string, unknown> | undefined, row: number, col: number): string | undefined {
  const t = notesOf(metadata)[String(col)]?.[String(row)];
  return t === undefined || t === "" ? undefined : t;
}

/** How many cells carry a note. */
export function noteCount(metadata: Record<string, unknown> | undefined): number {
  return Object.values(notesOf(metadata)).reduce((n, rows) => n + Object.keys(rows).length, 0);
}

/** One change: set the note on a cell, or clear it (`null`; empty or blank text clears too). */
export interface NoteChange {
  row: number;
  col: number;
  text: string | null;
}

export interface NotesResult {
  /** The metadata with the changes applied (the same object when nothing changed). */
  metadata: Record<string, unknown>;
  /** How many changes took effect. */
  applied: number;
  /** Why a change was refused (the first reason), if any was. */
  refused?: string;
}

/** `metadata` with `changes` applied in order. A change that would break a limit is refused and the rest
 *  carry on, so a bulk paste past the 2,000-note cap keeps what fits and reports the first reason. The sidecar
 *  key is removed when the last note goes, so an emptied sheet is no longer gated at v9 (`GATED_METADATA_KEYS`). */
export function withNotes(metadata: Record<string, unknown>, changes: readonly NoteChange[]): NotesResult {
  const notes = notesOf(metadata);
  let count = noteCount(metadata);
  let applied = 0;
  let refused: string | undefined;
  for (const { row, col, text } of changes) {
    const clear = text === null || text.trim() === "";
    const col_ = String(col);
    const row_ = String(row);
    const had = notes[col_]?.[row_] !== undefined;
    if (clear) {
      if (!had) continue;
      delete notes[col_][row_];
      if (Object.keys(notes[col_]).length === 0) delete notes[col_];
      count -= 1;
      applied += 1;
      continue;
    }
    if (text.length > MAX_NOTE_CHARS) {
      refused ??= `a note holds at most ${MAX_NOTE_CHARS.toLocaleString()} characters (this one has ${text.length.toLocaleString()})`;
      continue;
    }
    if (!had && count >= MAX_NOTES) {
      refused ??= `a worksheet holds at most ${MAX_NOTES.toLocaleString()} notes`;
      continue;
    }
    if (notes[col_]?.[row_] === text) continue;
    (notes[col_] ??= {})[row_] = text;
    if (!had) count += 1;
    applied += 1;
  }
  if (applied === 0) return { metadata, applied, refused };
  const next = { ...metadata };
  if (count > 0) next[CELL_NOTES_KEY] = notes;
  else delete next[CELL_NOTES_KEY];
  return { metadata: next, applied, refused };
}
