// The Worksheet stage tab's container (WORKSHEET_PLAN item 3): thin and
// prop-driven — takes an explicit `datasetId` (never `useActiveDataset()` or
// another singleton-view read), delegates state to `useWorksheetView` and
// layout to the toolbar / filter bar / virtualized grid / sheet-tab-strip
// subtree. This is most of Stage D's future mountability: a `WorksheetPane`
// with no reads of the globally-active dataset can, in principle, be mounted
// as MDI window content for ANY dataset (item 11 audits this contract;
// `plans/MULTI_PLOT_PLAN.md` item 17 owns the actual window-kind work — not
// built here).

import { useState } from "react";

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

  const openMenu = (kind: "col" | "row") => (target: number, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ kind, target, x: e.clientX, y: e.clientY });
  };

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
      {view.err && (
        <div className="qzk-ds-meta" style={{ padding: "4px 8px", color: "var(--danger)" }}>
          {view.err}
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
        onToggleSort={view.toggleSort}
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
