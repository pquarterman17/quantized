// Column/row right-click context-menu builders for the worksheet (extracted
// from Worksheet.tsx, WORKSHEET_PLAN item 3) — the grid parity of MATLAB's
// column/row uicontextmenus. Pure functions over an explicit context object so
// they're testable without rendering; `useWorksheetView` supplies the context,
// `WorksheetPane` opens a `ContextMenu` with whichever list the click target
// (a header column vs a data row) calls for.

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

/** Items for a right-clicked column header (`col` is -1 for the x column).
 *  Sort lives here ONLY (owner decision D1, item 6) — the header click
 *  gesture selects a column instead of sorting it. */
export function columnMenuItems(col: number, ctx: ColumnMenuContext): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: "Sort ascending", run: () => ctx.sortAsc(col) },
    { label: "Sort descending", run: () => ctx.sortDesc(col) },
  ];
  if (col >= 0) {
    const plotted = ctx.yKeys ?? Array.from({ length: ctx.labelCount }, (_, i) => i);
    const shown = plotted.includes(col);
    items.push({ separator: true });
    items.push({
      label: ctx.xKey === col ? "Already the X axis" : "Set as X axis",
      run: () => ctx.setXKey(col),
      disabled: ctx.xKey === col,
    });
    items.push(
      shown
        ? {
            label: "Hide from plot",
            run: () => ctx.setYKeys(plotted.filter((c) => c !== col)),
            disabled: plotted.length <= 1,
          }
        : { label: "Plot as Y", run: () => ctx.setYKeys([...plotted, col].sort((a, b) => a - b)) },
    );
  }
  items.push({ separator: true });
  items.push({ label: "Plot selection", run: ctx.onPlotSelection });
  items.push({ label: "Add selection to plot", run: ctx.onAddSelectionToPlot });
  items.push({ label: "Open in Graph Builder…", run: ctx.onOpenInGraphBuilder });
  items.push({ separator: true });
  items.push({ label: "New column from formula…", run: ctx.onNewColumn });
  items.push({
    label: ctx.showStats ? "Hide column statistics" : "Show column statistics",
    run: ctx.onToggleStats,
  });
  return items;
}

export interface RowMenuContext {
  masked: Set<number>;
  toggleMask: (row: number) => void;
  unmaskAll: () => void;
  copyRow: (row: number) => void;
}

/** Items for a right-clicked data row. */
export function rowMenuItems(row: number, ctx: RowMenuContext): ContextMenuItem[] {
  return [
    { label: ctx.masked.has(row) ? "Unmask row" : "Mask row", run: () => ctx.toggleMask(row) },
    { label: "Unmask all rows", run: ctx.unmaskAll, disabled: ctx.masked.size === 0 },
    { separator: true },
    { label: "Copy row (TSV)", run: () => ctx.copyRow(row) },
  ];
}
