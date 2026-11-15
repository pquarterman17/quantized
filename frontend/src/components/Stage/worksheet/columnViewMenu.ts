// The worksheet's column visibility commands as menu items (Hide / Show /
// Freeze), shared by the toolbar's "Columns" button and the column header's
// right-click menu. Pure: the controls object is supplied by
// ./useColumnVisibility.ts, so this is testable without rendering.
//
// Everything here is VIEW-only (lib/worksheetColumnView.ts): a hidden column
// still exists, can still be plotted, and formulas still reference it.

import type { ContextMenuItem } from "../../overlays/ContextMenu";

export interface ColumnViewControls {
  /** Every value column's label (index = column). */
  labels: readonly string[];
  /** Hidden columns, ascending. */
  hidden: readonly number[];
  /** How many leading columns are frozen. */
  frozen: number;
  /** The selected value columns (X excluded), ascending. */
  selected: readonly number[];
  hide: (cols: readonly number[]) => void;
  /** Show `cols`, or every hidden column when omitted. */
  show: (cols?: readonly number[]) => void;
  /** Freeze columns 0..col. */
  freezeThrough: (col: number) => void;
  unfreeze: () => void;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The Hide / Show / Freeze items. `target` is a right-clicked header's
 *  columns (the selection when it is part of it); without one (the toolbar) the
 *  selected columns are the target. */
export function columnViewItems(c: ColumnViewControls, target?: readonly number[]): ContextMenuItem[] {
  const cols = (target ?? c.selected).filter((k) => k >= 0 && !c.hidden.includes(k));
  const last = cols.length ? cols[cols.length - 1] : -1;
  const none = "select a column first";
  const items: ContextMenuItem[] = [
    {
      label: cols.length > 1 ? `Hide ${cols.length} columns` : "Hide column",
      disabled: cols.length === 0,
      title: cols.length === 0 ? none : "View only — hidden columns can still be plotted and used in formulas",
      run: () => c.hide(cols),
    },
    {
      label: c.hidden.length ? `Show all columns (${c.hidden.length} hidden)` : "Show all columns",
      disabled: c.hidden.length === 0,
      title: c.hidden.length === 0 ? "no columns are hidden" : undefined,
      run: () => c.show(),
    },
  ];
  if (c.hidden.length) {
    items.push({
      label: `Hidden columns (${c.hidden.length})`,
      submenu: c.hidden.map((k) => ({ label: `Show ${c.labels[k] ?? `column ${k + 1}`}`, run: () => c.show([k]) })),
    });
  }
  items.push(
    { separator: true },
    {
      label: last >= 0 ? `Freeze through "${c.labels[last] ?? last + 1}"` : "Freeze through column",
      disabled: last < 0,
      title: last < 0 ? none : "Keep the X column and every column up to this one in view while scrolling sideways",
      run: () => c.freezeThrough(last),
    },
    {
      label: c.frozen ? `Unfreeze columns (first ${plural(c.frozen, "column")})` : "Unfreeze columns",
      disabled: c.frozen === 0,
      title: c.frozen === 0 ? "no columns are frozen" : undefined,
      run: c.unfreeze,
    },
  );
  return items;
}
