// The cell-notes actions (plans/ROW_RANGE_CONTRACT.md 7.2). Lazy: the worksheet menu loads this on first use.
//
// A note edit is a `datasets` change, so one undo step covers it with no new snapshot field (contract 8).
// Consecutive edits of ONE note fold into one step (`recordHistoryCoalesced`, keyed by sheet, column and
// row); any other history entry in between closes the run. Refused on a re-derived sheet and deferred on a
// lazy (pending) book, exactly as a cell edit is.

import { type NoteChange, noteAt, notesOf, withNotes } from "../lib/cellNotes";
import type { NoteClip } from "../lib/cellNotesClip";
import { editRefusalNotice, isRederived } from "../lib/rederived";
import { sidecarRowCount } from "../lib/rowSidecars";
import type { Dataset } from "../lib/types";
import { askParams } from "./paramDialog";
import { resolvePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";

const get = useApp.getState;

/** The dataset when it can take a note edit now; otherwise says why (or defers) and returns null. */
function editable(id: string, retry: () => void): Dataset | null {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return null;
  if (isRederived(ds)) {
    get().setStatus(editRefusalNotice(ds), "danger");
    return null;
  }
  if (resolvePendingEdit(get, ds, "editing a note", retry)) return null;
  return ds;
}

const inBounds = (ds: Dataset, row: number, col: number): boolean =>
  Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < sidecarRowCount(ds.data.metadata, ds.data.time.length) && col >= -1 && col < ds.data.labels.length;

/** Write `changes` into dataset `id`'s sidecar. Returns the result, or null when nothing was written. */
function apply(id: string, changes: readonly NoteChange[], history?: { label: string; key: string }) {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return null;
  // The callers already deferred a lazy book; this is the write's own guard (store/pendingEdit.ts), so a
  // pending dataset's data is never written into (it is replaced wholesale when its fetch lands).
  if (resolvePendingEdit(get, ds, "editing a note", () => void apply(id, changes, history))) return null;
  const res = withNotes(ds.data.metadata ?? {}, changes);
  if (res.applied === 0) return res;
  if (history) get().recordHistoryCoalesced(history.label, history.key);
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => (d.id === id ? { ...d, data: { ...d.data, metadata: res.metadata } } : d)),
  }));
  return res;
}

/** Set (or, with null or blank text, clear) the note on one cell. */
export function setCellNote(id: string, row: number, col: number, text: string | null): boolean {
  const ds = editable(id, () => setCellNote(id, row, col, text));
  if (!ds) return false;
  if (!inBounds(ds, row, col)) {
    get().setStatus("that cell is outside the sheet", "danger");
    return false;
  }
  const clearing = text === null || text.trim() === "";
  const res = apply(id, [{ row, col, text }], { label: clearing ? "delete note" : "edit note", key: `note:${id}:${col}:${row}` });
  if (res?.refused) get().setStatus(`note not saved: ${res.refused}`, "danger");
  else if (res && res.applied > 0) get().setStatus(clearing ? "note deleted" : "note saved");
  return (res?.applied ?? 0) > 0;
}

/** Ask for the note's text (the current one pre-filled) and save it; empty text deletes the note. */
export async function editCellNote(id: string, row: number, col: number): Promise<void> {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  const current = noteAt(ds.data.metadata, row, col) ?? "";
  const label = `${col < 0 ? "X" : (ds.data.labels[col] ?? `column ${col + 1}`)}, row ${row + 1}`;
  const p = await askParams(
    current ? "Edit note" : "Add note",
    [{ key: "text", label, type: "text", multiline: true, default: current, placeholder: "Note text (leave empty to delete). Enter adds a line; Ctrl+Enter saves." }],
    { confirmLabel: "Save", message: "A note travels with its cell through sort, insert, delete and Extract. CSV and TSV exports cannot carry it; .xlsx writes it as a comment." },
  );
  if (p) setCellNote(id, row, col, String(p.text));
}

/** Cut's notes half: the cut cells give up their notes (the paste record, taken at copy time, carries them). Returns how many notes it cleared. Runs
 *  after the cut's `setCellBlock`, which owns the undo entry. */
export function clearNotes(id: string, cells: readonly { row: number; col: number }[]): number {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds || ds.pending != null || isRederived(ds)) return 0;
  return apply(id, cells.map(({ row, col }) => ({ row, col, text: null })))?.applied ?? 0;
}

/** Paste's notes half (contract 7.2, D16): the pasted cells take the notes of the copied cells, cell for cell,
 *  and an empty source cell clears the destination's note. Runs AFTER the paste's `setCellBlock`, which owns the
 *  undo entry, so one undo reverts values and notes together. `edits` are the cells the paste really wrote. */
export function pasteNotes(
  id: string,
  clip: NoteClip,
  edits: readonly { row: number; col: number }[],
  targets: readonly number[],
  anchorCol: number,
  grid: readonly (readonly string[])[],
): void {
  // The record must describe exactly the text on the clipboard: same block shape or it attaches nothing.
  if (clip.rows.length !== grid.length || grid.some((r) => r.length !== clip.cols.length)) return;
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds || ds.pending != null || isRederived(ds)) return;
  const source = notesOf(clip.metadata);
  const targetIndex = new Map(targets.map((r, i) => [r, i]));
  const changes: NoteChange[] = [];
  for (const e of edits) {
    const i = targetIndex.get(e.row);
    const j = e.col - anchorCol;
    if (i === undefined || j < 0 || j >= clip.cols.length) continue;
    changes.push({ row: e.row, col: e.col, text: source[String(clip.cols[j])]?.[String(clip.rows[i])] ?? null });
  }
  const res = apply(id, changes);
  if (res?.refused) get().setStatus(`some notes were not pasted: ${res.refused}`, "danger");
}
