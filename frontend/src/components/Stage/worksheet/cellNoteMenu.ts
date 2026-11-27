// The cell menu's note entries (plans/ROW_RANGE_CONTRACT.md 7.2): Add note, or Edit and Delete on a noted
// cell. Pure builder; the actions live in store/cellNotes.ts, loaded on first use so none of it is startup code.

import { noteAt } from "../../../lib/cellNotes";
import { editRefusalNotice, isRederived } from "../../../lib/rederived";
import { formatShortcut, isMacPlatform } from "../../../lib/shortcutFormat";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import type { Dataset } from "../../../lib/types";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

const lazyStore = () => runLazy("Loading notes…", () => import("../../../store/cellNotes"));

/** Open the note editor on one cell (the Alt+Shift+F2 key): the same refusal the menu entry shows, then the same editor. */
export function editNoteAt(ds: Dataset, col: number, row: number, setStatus: (message: string, tone?: "danger") => void): void {
  if (isRederived(ds)) return setStatus(editRefusalNotice(ds), "danger");
  void lazyStore().then((m) => m.editCellNote(ds.id, row, col), onLoadFailure);
}

/** The note entries for a right-click on column `col` (-1 is X), source row `row`, with a leading separator. */
export function cellNoteItems(ds: Dataset, col: number | undefined, row: number, isMac = isMacPlatform()): ContextMenuItem[] {
  if (col === undefined) return [];
  const noted = noteAt(ds.data.metadata, row, col) !== undefined;
  const reason = isRederived(ds) ? editRefusalNotice(ds) : undefined;
  const entry = (label: string, title: string, run: (m: typeof import("../../../store/cellNotes")) => unknown, shortcut?: string): ContextMenuItem => ({
    label,
    title: reason ?? title,
    ...(shortcut ? { shortcutLabel: shortcut } : {}),
    disabled: reason !== undefined,
    run: () => void lazyStore().then(run, onLoadFailure),
  });
  return [
    { separator: true },
    entry(noted ? "Edit note…" : "Add note…", "Attach text to this cell; it follows the cell through sort, insert and delete", (m) => m.editCellNote(ds.id, row, col), formatShortcut("⌥⇧F2", isMac)),
    ...(noted ? [entry("Delete note", "Remove this cell's note", (m) => m.setCellNote(ds.id, row, col, null))] : []),
  ];
}
