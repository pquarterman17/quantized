// Column/row right-click context-menu builders for the worksheet (extracted
// from Worksheet.tsx, WORKSHEET_PLAN item 3) — the grid parity of MATLAB's
// column/row uicontextmenus. Pure functions over an explicit context object so
// they're testable without rendering; `useWorksheetView` supplies the context,
// `WorksheetPane` opens a `ContextMenu` with whichever list the click target
// (a header column vs a data row) calls for.
//
// GUI_INTERACTION #8 retrofit: the fixed items are now `lib/contextActions`
// registry entries (`worksheetColumnActions` / `worksheetRowActions`),
// composed by `columnMenuItems`/`rowMenuItems` via `buildMenuItems` — same
// public signature and IDENTICAL output as before, so `WorksheetPane.tsx` and
// existing tests need no changes. Exported flat so a future palette/tree
// consumer can reuse the same definitions once the worksheet's `ctx` gains a
// store-level home (today it only exists inside a mounted `WorksheetPane` —
// see `lib/paletteContextActions`'s header note on this exact gap).

import { buildMenuItems, type ContextAction } from "../../../lib/contextActions";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

export interface ColumnMenuContext {
  xKey: number | null;
  /** The currently plotted Y channels, or null (meaning "all channels"). */
  yKeys: number[] | null;
  labelCount: number;
  setXKey: (col: number) => void;
  setYKeys: (cols: number[]) => void;
  sortAsc: (col: number) => void;
  sortDesc: (col: number) => void;
  onNewColumn: () => void;
  showStats: boolean;
  onToggleStats: () => void;
  /** Selection→plot (item 7): apply the designation-aware mapping over the
   *  CURRENT column selection (or, when nothing is selected, just the
   *  right-clicked column — see `WorksheetPane.effectiveCols`).
   *  "Plot selection" replaces yKeys; "Add to plot" unions it in. */
  onPlotSelection: () => void;
  onAddSelectionToPlot: () => void;
  /** Selection → Graph Builder handoff (MAIN_PLAN #4): open the Graph
   *  Builder prefilled with a spec built from the same effective columns. */
  onOpenInGraphBuilder: () => void;
}

export interface WorksheetColumnTarget {
  col: number;
  ctx: ColumnMenuContext;
}

const plottedCols = (t: WorksheetColumnTarget) =>
  t.ctx.yKeys ?? Array.from({ length: t.ctx.labelCount }, (_, i) => i);
const isPlotted = (t: WorksheetColumnTarget) => plottedCols(t).includes(t.col);

const worksheetSortAscAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.sortAsc",
  label: "Sort ascending",
  run: (t) => t.ctx.sortAsc(t.col),
};

const worksheetSortDescAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.sortDesc",
  label: "Sort descending",
  run: (t) => t.ctx.sortDesc(t.col),
};

// Sort lives here ONLY (owner decision D1, item 6) — the header click gesture
// selects a column instead of sorting it; the set-X / plot-toggle pair below
// only make sense for a real data column (`col` is -1 for the x column).
const worksheetSetXAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.setX",
  label: (t) => (t.ctx.xKey === t.col ? "Already the X axis" : "Set as X axis"),
  enabled: (t) => t.ctx.xKey !== t.col,
  hidden: (t) => t.col < 0,
  run: (t) => t.ctx.setXKey(t.col),
};

const worksheetPlotToggleAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.plotToggle",
  label: (t) => (isPlotted(t) ? "Hide from plot" : "Plot as Y"),
  // Hiding the last remaining plotted column would empty the plot — same
  // guard the original inline code used (`plotted.length <= 1`). Adding a
  // column is always allowed.
  enabled: (t) => !isPlotted(t) || plottedCols(t).length > 1,
  hidden: (t) => t.col < 0,
  run: (t) => {
    const plotted = plottedCols(t);
    t.ctx.setYKeys(
      isPlotted(t) ? plotted.filter((c) => c !== t.col) : [...plotted, t.col].sort((a, b) => a - b),
    );
  },
};

const worksheetPlotSelectionAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.plotSelection",
  label: "Plot selection",
  run: (t) => t.ctx.onPlotSelection(),
};

const worksheetAddSelectionToPlotAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.addSelectionToPlot",
  label: "Add selection to plot",
  run: (t) => t.ctx.onAddSelectionToPlot(),
};

const worksheetOpenInGraphBuilderAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.openInGraphBuilder",
  label: "Open in Graph Builder…",
  run: (t) => t.ctx.onOpenInGraphBuilder(),
};

const worksheetNewColumnAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.newColumn",
  label: "New column from formula…",
  run: (t) => t.ctx.onNewColumn(),
};

const worksheetStatsToggleAction: ContextAction<WorksheetColumnTarget> = {
  id: "worksheet.statsToggle",
  label: (t) => (t.ctx.showStats ? "Hide column statistics" : "Show column statistics"),
  run: (t) => t.ctx.onToggleStats(),
};

/** Every column action, flat — for callers that don't care about layout. */
export const worksheetColumnActions: ContextAction<WorksheetColumnTarget>[] = [
  worksheetSortAscAction,
  worksheetSortDescAction,
  worksheetSetXAction,
  worksheetPlotToggleAction,
  worksheetPlotSelectionAction,
  worksheetAddSelectionToPlotAction,
  worksheetOpenInGraphBuilderAction,
  worksheetNewColumnAction,
  worksheetStatsToggleAction,
];

/** Items for a right-clicked column header (`col` is -1 for the x column). */
export function columnMenuItems(col: number, ctx: ColumnMenuContext): ContextMenuItem[] {
  const target: WorksheetColumnTarget = { col, ctx };
  return [
    ...buildMenuItems([worksheetSortAscAction, worksheetSortDescAction], target),
    // The set-X/plot-toggle pair (and its leading separator) only applies to
    // a real column — both entries self-hide for col < 0 too, but the
    // separator itself must not appear on its own.
    ...(col >= 0
      ? ([{ separator: true }, ...buildMenuItems([worksheetSetXAction, worksheetPlotToggleAction], target)] as ContextMenuItem[])
      : []),
    { separator: true },
    ...buildMenuItems(
      [worksheetPlotSelectionAction, worksheetAddSelectionToPlotAction, worksheetOpenInGraphBuilderAction],
      target,
    ),
    { separator: true },
    ...buildMenuItems([worksheetNewColumnAction, worksheetStatsToggleAction], target),
  ];
}

export interface RowMenuContext {
  masked: Set<number>;
  toggleMask: (row: number) => void;
  unmaskAll: () => void;
  copyRow: (row: number) => void;
}

export interface WorksheetRowTarget {
  row: number;
  ctx: RowMenuContext;
}

const worksheetMaskToggleAction: ContextAction<WorksheetRowTarget> = {
  id: "worksheet.maskToggle",
  label: (t) => (t.ctx.masked.has(t.row) ? "Unmask row" : "Mask row"),
  run: (t) => t.ctx.toggleMask(t.row),
};

const worksheetUnmaskAllAction: ContextAction<WorksheetRowTarget> = {
  id: "worksheet.unmaskAll",
  label: "Unmask all rows",
  enabled: (t) => t.ctx.masked.size > 0,
  run: (t) => t.ctx.unmaskAll(),
};

const worksheetCopyRowAction: ContextAction<WorksheetRowTarget> = {
  id: "worksheet.copyRow",
  label: "Copy row (TSV)",
  run: (t) => t.ctx.copyRow(t.row),
};

/** Every row action, flat — for callers that don't care about layout. */
export const worksheetRowActions: ContextAction<WorksheetRowTarget>[] = [
  worksheetMaskToggleAction,
  worksheetUnmaskAllAction,
  worksheetCopyRowAction,
];

/** Items for a right-clicked data row. */
export function rowMenuItems(row: number, ctx: RowMenuContext): ContextMenuItem[] {
  const target: WorksheetRowTarget = { row, ctx };
  return [
    ...buildMenuItems([worksheetMaskToggleAction, worksheetUnmaskAllAction], target),
    { separator: true },
    ...buildMenuItems([worksheetCopyRowAction], target),
  ];
}
