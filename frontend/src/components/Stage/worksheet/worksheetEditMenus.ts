// The worksheet's STRUCTURE menu entries — Origin's column and row commands
// (Insert / Add New Column / Delete / Move, edit the header rows, Set Column
// Values on a formula column, the display format, Sort Worksheet; Insert /
// Delete / Move rows). Pure builders over an explicit context, like
// ./worksheetMenus.ts; WorksheetMenus.tsx appends them to those menus and
// supplies the callbacks (store/worksheetColumns.ts, store/moveRows.ts, and
// the dialogs in ./worksheetDialogs.ts).

import type { ContextMenuItem } from "../../overlays/ContextMenu";
import type { RowMove } from "../../../store/moveRows";

export type ColumnMove = "left" | "right" | "first" | "last";

export interface ColumnEditContext {
  /** Value columns before the computed ones; `col >= baseCount` is computed. */
  baseCount: number;
  /** The columns the command acts on (the selection, or the clicked one). */
  targets: number[];
  editHeader: (col: number) => void;
  setColumnValues: (col: number) => void;
  numberFormat: () => void;
  insertColumn: (col: number) => void;
  addColumn: () => void;
  deleteColumns: () => void;
  moveColumn: (col: number, where: ColumnMove) => void;
  sortWorksheet: () => void;
}

/** The structure section of a column header's menu (`col` -1 = X). */
export function columnEditItems(col: number, ctx: ColumnEditContext): ContextMenuItem[] {
  const computed = col >= ctx.baseCount;
  const movable = col >= 0 && !computed;
  const n = ctx.targets.length;
  const why = col < 0 ? "the X column stays first" : "a computed column's place follows its formula order";
  return [
    { separator: true },
    { label: "Edit Long Name / Units / Comments…", shortcutLabel: "⇧F2", run: () => ctx.editHeader(col) },
    ...(computed ? [{ label: "Set Column Values… (edit formula)", run: () => ctx.setColumnValues(col) }] : []),
    { label: n > 1 ? `Number format (${n} columns)…` : "Number format…", run: ctx.numberFormat },
    { separator: true },
    { label: "Insert column", title: "Insert a blank column to the left of this one", run: () => ctx.insertColumn(col) },
    { label: "Add new column", title: "Append a blank column after the last data column", run: ctx.addColumn },
    {
      label: n > 1 ? `Delete ${n} columns` : "Delete column",
      danger: true,
      disabled: n === 1 && col < 0,
      title: n === 1 && col < 0 ? "the X column can't be deleted — Set As X another column first" : undefined,
      run: ctx.deleteColumns,
    },
    {
      label: "Move column",
      disabled: !movable,
      title: movable ? undefined : why,
      submenu: (
        [
          ["left", "Move left"],
          ["right", "Move right"],
          ["first", "Move to first"],
          ["last", "Move to last"],
        ] as const
      ).map(([where, label]) => ({ label, run: () => ctx.moveColumn(col, where) })),
    },
    { separator: true },
    { label: "Sort worksheet…", title: "Sort every row by one or more columns (one undo step)", run: ctx.sortWorksheet },
  ];
}

export interface RowEditContext {
  /** The rows the command acts on (the selection, or the clicked one). */
  count: number;
  insertRows: () => void;
  deleteRows: () => void;
  moveRows: (where: RowMove) => void;
}

/** The structure section of a row number's menu. */
export function rowEditItems(ctx: RowEditContext): ContextMenuItem[] {
  const rows = ctx.count === 1 ? "row" : `${ctx.count} rows`;
  return [
    { separator: true },
    { label: `Insert ${rows} above`, run: ctx.insertRows },
    { label: `Delete ${rows}`, danger: true, run: ctx.deleteRows },
    {
      label: ctx.count === 1 ? "Move row" : "Move rows",
      submenu: (
        [
          ["up", "Move up"],
          ["down", "Move down"],
          ["top", "Move to top"],
          ["bottom", "Move to bottom"],
        ] as const
      ).map(([where, label]) => ({ label, run: () => ctx.moveRows(where) })),
    },
  ];
}
