// The worksheet's right-click menus — column header, row number and text
// column — moved out of WorksheetPane under the component ceiling. The item
// lists are the pure builders in ./worksheetMenus.ts (plot, sort, Set As) and
// ./worksheetEditMenus.ts (Origin's column and row structure commands); this
// component only wires them to the dataset and opens the ContextMenu.
//
// A command acts on the whole selection when the right-clicked line is part
// of it, otherwise on just that line — the spreadsheet convention, and the one
// the toolbar's "N selected" buttons follow.

import { isCategoricalChannel } from "../../../lib/categorical";
import { effectiveDesignations, type OriginDesignation } from "../../../lib/columnmeta";
import { isRederived } from "../../../lib/rederived";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import type { Dataset } from "../../../lib/types";
import { deleteRowsAt, insertRowsAbove, moveWorksheetRows } from "../../../store/moveRows";
import { useRecode } from "../../../store/recode";
import { useLevelOrderPanel } from "../../../store/levelOrderPanel";
import { sortWorksheetRows } from "../../../store/sortRows";
import { deleteColumns, insertColumn, moveColumn } from "../../../store/worksheetColumns";
import ContextMenu, { type ContextMenuItem } from "../../overlays/ContextMenu";
import type { WorksheetView } from "./useWorksheetView";
import { numberFormatDialog, setColumnValuesDialog, sortWorksheetDialog } from "./worksheetDialogs";
import { columnEditItems, rowEditItems, type ColumnMove } from "./worksheetEditMenus";
import { columnMenuItems, rowMenuItems } from "./worksheetMenus";

export type WorksheetMenu =
  | { kind: "col" | "row"; target: number; x: number; y: number }
  | { kind: "text"; name: string; x: number; y: number };

export interface WorksheetMenusProps {
  ds: Dataset;
  view: WorksheetView;
  menu: WorksheetMenu | null;
  onClose: () => void;
  /** Open the header-row editor for `col` near (x, y). */
  onEditHeader: (col: number) => void;
}

export default function WorksheetMenus({ ds, view, menu, onClose, onEditHeader }: WorksheetMenusProps) {
  if (!menu) return null;
  const help = { label: "worksheets", query: "worksheet" };
  if (menu.kind === "text") {
    return (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        help={help}
        onClose={onClose}
        items={[
          { label: "Sort ascending (by text)", run: () => sortWorksheetRows(ds.id, menu.name, 1) },
          { label: "Sort descending (by text)", run: () => sortWorksheetRows(ds.id, menu.name, -1) },
        ]}
      />
    );
  }
  const readOnly = isRederived(ds);
  const t = menu.target;
  const items = menu.kind === "col" ? columnItems(ds, view, t, readOnly, onEditHeader) : rowItems(ds, view, t, readOnly);
  return <ContextMenu x={menu.x} y={menu.y} help={help} onClose={onClose} items={items} />;
}

function columnItems(
  ds: Dataset,
  view: WorksheetView,
  col: number,
  readOnly: boolean,
  onEditHeader: (col: number) => void,
): ContextMenuItem[] {
  // The header selection when the clicked column is in it, else just the
  // clicked column — never a cell range that merely crosses it, so a header
  // right-click can't delete columns the user didn't select as columns.
  const targets = view.selectedCols.has(col) ? [...view.selectedCols].sort((a, b) => a - b) : [col];
  const baseCount = view.baseCount;
  const move = (c: number, where: ColumnMove) =>
    moveColumn(ds.id, c, where === "left" ? c - 1 : where === "right" ? c + 1 : where === "first" ? 0 : baseCount - 1);
  return [
    ...columnMenuItems(col, {
      xKey: view.xKey,
      yKeys: view.yKeys,
      labelCount: view.data.labels.length,
      setXKey: view.setXKey,
      setYKeys: view.setYKeys,
      // A DATA sort, as Origin's column Sort is (store/sortRows.ts).
      sortAsc: (c) => sortWorksheetRows(ds.id, c, 1),
      sortDesc: (c) => sortWorksheetRows(ds.id, c, -1),
      viewSortMark: view.sortMark,
      toggleViewSort: view.toggleSort,
      onNewColumn: () => void view.promptColumn(),
      showStats: view.showStats,
      onToggleStats: () => view.setShowStats((v) => !v),
      onPlotSelection: () => view.plotCols(targets, "replace"),
      onAddSelectionToPlot: () => view.plotCols(targets, "add"),
      onOpenInGraphBuilder: () => view.openInGraphBuilder(targets),
      ...(readOnly
        ? {}
        : {
            designationOf: (c: number) => effectiveDesignations(ds.data, ds.columnDesignations)[c],
            setDesignation: (c: number, d: OriginDesignation) =>
              void runLazy("Loading Set As…", () => import("../../../store/columnDesignationActions")).then(
                (m) => m.setColumnDesignation(ds.id, c, d),
                onLoadFailure,
              ),
          }),
    }),
    ...(readOnly
      ? []
      : columnEditItems(col, {
          baseCount,
          targets,
          editHeader: onEditHeader,
          setColumnValues: (c) => void setColumnValuesDialog(ds, c),
          numberFormat: () => void numberFormatDialog(ds, targets),
          insertColumn: (c) => insertColumn(ds.id, Math.max(0, c)),
          addColumn: () => insertColumn(ds.id, baseCount),
          deleteColumns: () => {
            deleteColumns(ds.id, targets);
            view.clearColSelection();
          },
          moveColumn: move,
          sortWorksheet: () => void sortWorksheetDialog(ds, view.xName, view.textCols),
        })),
    // J2: only a real, categorical value column can be recoded (never the x
    // column or a column with no level table). JMP_GAP J1 (Group O-2b): the
    // same guard covers Reorder levels, which sets the TINY panel-flag store
    // (store/levelOrderPanel.ts) directly, not the heavy store/levelOrder.ts —
    // importing that would pull lib/recode.ts into the eager bundle.
    ...(col >= 0 && isCategoricalChannel(ds.data, col)
      ? ([
          { separator: true },
          { label: "Recode…", run: () => useRecode.getState().openRecode(ds.id, col) },
          { label: "Reorder levels…", run: () => useLevelOrderPanel.getState().openPanel(ds.id, col) },
        ] as const)
      : []),
  ];
}

function rowItems(ds: Dataset, view: WorksheetView, row: number, readOnly: boolean): ContextMenuItem[] {
  const targets = view.selected.has(row) ? [...view.selected].sort((a, b) => a - b) : [row];
  return [
    ...rowMenuItems(row, {
      masked: view.masked,
      toggleMask: view.toggleMask,
      unmaskAll: view.unmaskAll,
      copyRow: view.copyRow,
    }),
    ...(readOnly
      ? []
      : rowEditItems({
          count: targets.length,
          insertRows: () => insertRowsAbove(ds.id, targets),
          deleteRows: () => {
            deleteRowsAt(ds.id, targets);
            if (view.selected.has(row)) view.clearRowSelection();
          },
          moveRows: (where) => {
            const now = moveWorksheetRows(ds.id, targets, where);
            if (now && view.selected.has(row)) view.setRowSelection(now);
          },
        })),
  ];
}
