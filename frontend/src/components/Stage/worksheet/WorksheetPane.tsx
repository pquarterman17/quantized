// The Worksheet stage tab's container (WORKSHEET_PLAN item 3): thin and
// prop-driven — takes an explicit `datasetId` (never `useActiveDataset()` or
// another singleton-view read), delegates state to `useWorksheetView` and
// layout to the toolbar / filter bar / virtualized grid / sheet-tab-strip
// subtree.
//
// Stage D mount contract (item 11 — audited 2026-07-09): every module under
// `components/Stage/worksheet/` takes its dataset EXPLICITLY (a `datasetId`
// prop here, threaded down as a resolved `Dataset`/`DataStruct` everywhere
// below) and reads NO `useActiveDataset()` / `s.activeId` singleton anywhere
// in the subtree — grep-verified clean. The one exception, BY DESIGN, is the
// pre-existing plot-view singletons (`xKey`/`yKeys`/`selection`, read via
// `useWorksheetView`): those are the CURRENT globally-shared plot/row-
// selection state the column context menu and selection→plot (item 7)
// legitimately read/write today, same as Tier 1's "Set as X axis"/"Plot as
// Y" did before this item — they are not a "which dataset am I showing"
// decision, so they don't violate the mountability contract. Making THOSE
// window-scoped (so N worksheet windows could each show a different plot
// view) is `plans/MULTI_PLOT_PLAN.md` item 15's job; promoting the worksheet
// itself to a floatable MDI window kind is item 17's — both explicitly
// OUT of scope here. This comment is the plan-hygiene cross-reference item
// 11 asks for: the worksheet half of item 17's precondition (a mountable,
// dataset-agnostic container) is satisfied by this component as it stands.

import { useEffect, useState } from "react";

import { hasOriginReportSheets } from "../../../lib/columnmeta";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import ContextMenu from "../../overlays/ContextMenu";
import GridViewport from "./GridViewport";
import SheetTabs from "./SheetTabs";
import { useWorksheetView } from "./useWorksheetView";
import WorksheetFilterBar from "./WorksheetFilterBar";
import WorksheetToolbar from "./WorksheetToolbar";
import { columnMenuItems, rowMenuItems } from "./worksheetMenus";

export interface WorksheetPaneProps {
  datasetId: string;
}

export default function WorksheetPane({ datasetId }: WorksheetPaneProps) {
  const ds = useApp((s) => s.datasets.find((d) => d.id === datasetId));
  if (!ds) {
    return (
      <div className="qzk-sheet qzk-ds-meta" style={{ padding: 12 }}>
        Select a dataset
      </div>
    );
  }
  return <WorksheetPaneView ds={ds} />;
}

/** Split out from `WorksheetPane` so `useWorksheetView` (and every other hook
 *  below) is only ever called once a dataset is guaranteed to exist — hooks
 *  can't be called conditionally. */
function WorksheetPaneView({ ds }: { ds: Dataset }) {
  const view = useWorksheetView(ds);
  const [menu, setMenu] = useState<{ kind: "col" | "row"; target: number; x: number; y: number } | null>(null);

  // ORIGIN_FILE_DECODE_PLAN #38: opening the worksheet on a still-lazy Origin
  // book fetches its full data (the grid below renders the preview rows
  // until then — a real DataStruct, just fewer of them, so nothing crashes).
  useEffect(() => {
    if (ds.pending) useApp.getState().ensureBookData(ds.id);
  }, [ds.id, ds.pending]);

  const openMenu = (kind: "col" | "row") => (target: number, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ kind, target, x: e.clientX, y: e.clientY });
  };

  // Right-clicking a column that's already part of a multi-column selection
  // acts on the WHOLE selection (matching the toolbar's "N selected" buttons);
  // right-clicking an unselected column acts on just that one — the usual
  // spreadsheet convention for an ad hoc single-column plot/replot.
  const effectiveCols = (target: number) => (view.selectedCols.has(target) ? [...view.selectedCols] : [target]);

  return (
    <div className="qzk-sheet">
      <WorksheetToolbar
        formula={view.formula}
        colName={view.colName}
        setFormula={view.setFormula}
        setColName={view.setColName}
        onAddColumn={view.addColumn}
        showStats={view.showStats}
        onToggleStats={() => view.setShowStats((v) => !v)}
        onCopy={view.copyRows}
        maskedCount={view.masked.size}
        onUnmaskAll={view.unmaskAll}
        selectedCount={view.selectedCount}
        onExcludeSelected={view.excludeSelectedRows}
        onKeepOnlySelected={view.keepOnlySelectedRows}
        onClearSelection={view.clearRowSelection}
        vars={view.vars}
        selectedColCount={view.selectedCols.size}
        onPlotSelection={view.plotSelection}
        onAddSelectionToPlot={view.addSelectionToPlot}
        onClearColSelection={view.clearColSelection}
      />

      <WorksheetFilterBar
        xName={view.xName}
        labels={view.data.labels}
        filterCol={view.filterCol}
        filterOp={view.filterOp}
        filterV1={view.filterV1}
        filterV2={view.filterV2}
        setFilterCol={view.setFilterCol}
        setFilterOp={view.setFilterOp}
        setFilterV1={view.setFilterV1}
        setFilterV2={view.setFilterV2}
        filterActive={view.filterActive}
        keptCount={view.filtered.length}
        totalCount={view.data.time.length}
        maskedCount={view.masked.size}
        canExtract={view.canExtract}
        onExtract={view.extractSubset}
      />
      {ds.pending && (
        <div className="qzk-ds-meta" style={{ padding: "4px 8px", color: "var(--text-faint)" }}>
          Loading full data ({ds.pending.rows} rows × {ds.pending.cols} channels) — showing a preview
          for now.
        </div>
      )}
      {view.err && (
        <div className="qzk-ds-meta" style={{ padding: "4px 8px", color: "var(--danger)" }}>
          {view.err}
        </div>
      )}
      {hasOriginReportSheets(ds.data) && (
        <div className="qzk-ds-meta" style={{ padding: "4px 8px", color: "var(--text-faint)" }}>
          This sheet has Origin report-sheet columns not shown here — see Inspector › Origin provenance.
        </div>
      )}

      <GridViewport
        data={view.data}
        xName={view.xName}
        xUnit={view.xUnit}
        order={view.order}
        masked={view.masked}
        filteredOut={view.filteredOut}
        selected={view.selected}
        channelRoles={view.channelRoles}
        sortMark={view.sortMark}
        selectedCols={view.selectedCols}
        onToggleColSelect={view.toggleColSelected}
        onSelectColRange={view.setColSelection}
        onToggleSelect={view.toggleRowSelected}
        onSelectRange={view.setRowSelection}
        onEditCell={view.onEditCell}
        baseCount={view.baseCount}
        onRemoveFormula={view.onRemoveFormula}
        showStats={view.showStats}
        colStats={view.colStats}
        statsErr={view.statsErr}
        onHeaderContext={openMenu("col")}
        onRowContext={openMenu("row")}
        textCols={view.textCols}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            menu.kind === "col"
              ? columnMenuItems(menu.target, {
                  xKey: view.xKey,
                  yKeys: view.yKeys,
                  labelCount: view.data.labels.length,
                  setXKey: view.setXKey,
                  setYKeys: view.setYKeys,
                  sortAsc: (col) => view.setSort({ col, dir: 1 }),
                  sortDesc: (col) => view.setSort({ col, dir: -1 }),
                  onNewColumn: () => void view.promptColumn(),
                  showStats: view.showStats,
                  onToggleStats: () => view.setShowStats((v) => !v),
                  onPlotSelection: () => view.plotCols(effectiveCols(menu.target), "replace"),
                  onAddSelectionToPlot: () => view.plotCols(effectiveCols(menu.target), "add"),
                })
              : rowMenuItems(menu.target, {
                  masked: view.masked,
                  toggleMask: view.toggleMask,
                  unmaskAll: view.unmaskAll,
                  copyRow: view.copyRow,
                })
          }
        />
      )}

      <SheetTabs datasetId={ds.id} />
    </div>
  );
}
