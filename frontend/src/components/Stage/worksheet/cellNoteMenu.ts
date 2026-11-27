// The cell menu's note entries (plans/ROW_RANGE_CONTRACT.md 7.2): Add note, or Edit and Delete on a noted
// cell. Pure builder; the actions live in store/cellNotes.ts, loaded on first use so none of it is startup code.

import { noteAt } from "../../../lib/cellNotes";
import { editRefusalNotice, isRederived } from "../../../lib/rederived";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import type { Dataset } from "../../../lib/types";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

const lazyStore = () => runLazy("Loading notes…", () => import("../../../store/cellNotes"));

/** The note entries for a right-click on column `col` (-1 is X), source row `row`, with a leading separator. */
export function cellNoteItems(ds: Dataset, col: number | undefined, row: number): ContextMenuItem[] {
  if (col === undefined) return [];
  const noted = noteAt(ds.data.metadata, row, col) !== undefined;
  const reason = isRederived(ds) ? editRefusalNotice(ds) : undefined;
  const entry = (label: string, title: string, run: (m: typeof import("../../../store/cellNotes")) => unknown): ContextMenuItem => ({
    label,
    title: reason ?? title,
    disabled: reason !== undefined,
    run: () => void lazyStore().then(run, onLoadFailure),
  });
  return [
    { separator: true },
    entry(noted ? "Edit note…" : "Add note…", "Attach text to this cell; it follows the cell through sort, insert and delete", (m) => m.editCellNote(ds.id, row, col)),
    ...(noted ? [entry("Delete note", "Remove this cell's note", (m) => m.setCellNote(ds.id, row, col, null))] : []),
  ];
}
