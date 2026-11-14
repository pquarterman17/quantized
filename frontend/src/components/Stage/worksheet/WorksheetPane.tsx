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
// in the subtree — grep-verified clean.
//
// MULTI_PLOT_PLAN item 17 (2026-07-10) promoted this component to a
// floatable MDI window kind (`kind:"worksheet"` —
// components/windows/DocumentWindow.tsx mounts it inside a PlotWindowFrame),
// which introduced a v1 wart GUI_INTERACTION #14 fixes: an optional
// `windowId` prop (the MDI window's id, threaded to `useWorksheetView`) gives
// each document window its OWN row selection, independent of every other
// worksheet window — including the Stage tab (`windowId` omitted) and any
// OTHER document window on the SAME dataset. The one deliberate exception is
// `useWorksheetView`'s `plotLinked`/gated `xKey`/`yKeys`: while this
// worksheet's dataset IS the live/focused plot's dataset, row selection and
// the column menu's X/Y-axis actions stay linked to it (WorksheetToolbar's
// "Linked to plot" badge makes that explicit) — never silent, never assumed.

import { useCallback, useEffect, useRef, useState } from "react";

import { bookFetchSettled, lastBookError, truncateReason } from "../../../lib/bookData";
import { hasOriginReportSheets } from "../../../lib/originTextColumns";
import { isRederived, rederivedNotice } from "../../../lib/rederived";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import { channelModelingType } from "../../../lib/modeling";
import type { BookSource, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import GridViewport from "./GridViewport";
import HeaderEditor, { type HeaderEditTarget } from "./HeaderEditor";
import SheetTabs from "./SheetTabs";
import { useGridCursor } from "./useGridCursor";
import { useRowReveal } from "./useRowReveal";
import { useWorksheetView } from "./useWorksheetView";
import WorksheetFilterBar from "./WorksheetFilterBar";
import WorksheetMenus, { type WorksheetMenu } from "./WorksheetMenus";
import WorksheetToolbar from "./WorksheetToolbar";

/** "⇩ Export…": this sheet, or its selected rows in view order (lazy body). */
function exportSheet(ds: Dataset, rows: number[]): void {
  void runLazy("Loading export…", () => import("../../../commands/worksheetExport"))
    // A still-pending book shows preview rows, which name no real row: export it all.
    .then((m) => m.runExportWorksheet(useApp.getState, { ids: [ds.id], rows: ds.pending ? [] : rows }), onLoadFailure);
}

export interface WorksheetPaneProps {
  datasetId: string;
  /** GUI_INTERACTION #14: an MDI document window's id — omit for the Stage
   *  "Worksheet" tab (see useWorksheetView's doc for what this changes). */
  windowId?: string;
}

/** PR K (L0.50): the derived-worksheet identity banner + Freeze Copy action.
 *  Its own function (not a separate file) — WorksheetPane has room under the
 *  component ceiling; splitting further would be premature. */
function DerivedWorksheetBanner({ ds }: { ds: Dataset }) {
  const sourceName = useApp((s) => s.datasets.find((d) => d.id === ds.derivedFrom?.datasetId)?.name);
  if (!ds.derivedFrom) return null;
  return (
    <div className="qzk-ds-meta" style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 8 }}>
      <span title={`Pipeline: ${ds.derivedFrom.pipeline}`}>
        Derived worksheet — source: {sourceName ?? ds.derivedFrom.datasetId}
      </span>
      <button
        className="qz-btn"
        title="Create a permanent, independent snapshot of this worksheet's current data (link severed)"
        onClick={() => useApp.getState().freezeCopy(ds.id)}
      >
        Freeze Copy
      </button>
    </div>
  );
}

export default function WorksheetPane({ datasetId, windowId }: WorksheetPaneProps) {
  const ds = useApp((s) => s.datasets.find((d) => d.id === datasetId));
  if (!ds) {
    return (
      <div className="qzk-sheet qzk-ds-meta" style={{ padding: 12 }}>
        Select a dataset
      </div>
    );
  }
  return <WorksheetPaneView ds={ds} windowId={windowId} />;
}

/** Split out from `WorksheetPane` so `useWorksheetView` (and every other hook
 *  below) is only ever called once a dataset is guaranteed to exist — hooks
 *  can't be called conditionally. */
function WorksheetPaneView({ ds, windowId }: { ds: Dataset; windowId?: string }) {
  const view = useWorksheetView(ds, windowId);
  const reveal = useRowReveal(ds, view, windowId);
  // The right-click menus (./WorksheetMenus.tsx) and the header-row editor.
  const [menu, setMenu] = useState<WorksheetMenu | null>(null);
  const [headerEdit, setHeaderEdit] = useState<HeaderEditTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Open the header editor ON column `col`'s header cell. */
  const editHeader = (col: number) => {
    const cells = rootRef.current?.querySelectorAll<HTMLElement>("[data-col]") ?? [];
    const cell = [...cells].find((el) => el.dataset.col === String(col));
    const box = cell?.getBoundingClientRect();
    setHeaderEdit({ col, x: box?.left ?? 80, y: box?.bottom ?? 80 }); // just under the header
  };
  const cursor = useGridCursor(ds, view, {
    onColumnMenu: (col, x, y) => setMenu({ kind: "col", target: col, x, y }),
    onEditHeader: editHeader,
  });
  const closeHeaderEdit = useCallback(() => setHeaderEdit(null), []);
  // Two scroll requests share the grid's one `reveal`: an outside "show this
  // row" (useRowReveal) and the cursor's own moves. The newer one wins.
  const [rowRevealFirst, setRowRevealFirst] = useState(false);
  useEffect(() => setRowRevealFirst(true), [reveal.target]);
  useEffect(() => setRowRevealFirst(false), [cursor.reveal]);

  // ORIGIN_FILE_DECODE_PLAN #38: opening the worksheet on a still-lazy Origin
  // book fetches its full data (the grid below renders the preview rows
  // until then — a real DataStruct, just fewer of them, so nothing crashes).
  // A failed fetch (an expired upload, a moved file) must not leave the
  // banner below promising "Loading full data" forever: remember which source
  // failed, and why (`lastBookError`), once the kicked fetch has settled.
  const [loadFailure, setLoadFailure] = useState<{ source: BookSource; reason: string } | null>(null);
  useEffect(() => {
    const source = ds.pending;
    if (!source) return;
    let live = true;
    useApp.getState().ensureBookData(ds.id);
    void bookFetchSettled(ds.id, source)?.then(() => {
      const reason = lastBookError(ds.id, source);
      if (live && reason) setLoadFailure({ source, reason });
    });
    return () => {
      live = false;
    };
  }, [ds.id, ds.pending]);
  const failedReason = loadFailure && loadFailure.source === ds.pending ? loadFailure.reason : null;

  const openMenu = (kind: "col" | "row") => (target: number, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ kind, target, x: e.clientX, y: e.clientY });
  };

  // MAIN #34 keyboard bindings. Scoped to the pane, not the window, so the
  // worksheet cannot hijack ⌘C while the user is copying from the plot or a
  // dialog. An active cell EDIT is left alone — the native input handles its
  // own clipboard, and stealing ⌘V there would paste a grid over a half-typed
  // number. The cell cursor (./useGridCursor.ts) takes the keys first; what it
  // leaves acts on the row × column selection.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (cursor.onKeyDown(e)) {
      e.preventDefault();
      return;
    }
    const target = e.target as HTMLElement | null;
    // SELECT included (review fix): the filter bar's <select>s use arrows
    // natively — same exemption set as useGlobalShortcuts' isEditing.
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    const accel = e.metaKey || e.ctrlKey;
    if (accel && e.key === "c") { e.preventDefault(); view.blockOps.copyBlock(); }
    else if (accel && e.key === "x") { e.preventDefault(); view.blockOps.cutBlock(); }
    else if (accel && e.key === "v") { e.preventDefault(); view.blockOps.pasteBlock(); }
    else if (accel && e.key === "d") { e.preventDefault(); view.blockOps.fillDown(); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      // Delete clears CONTENT, matching every spreadsheet. Removing rows is a
      // structural edit and stays an explicit button — one stray keypress
      // should not renumber the sheet. Retrospective-audit P1 fix: consumed
      // UNCONDITIONALLY — with no block selected (a Tab-focused toolbar
      // button or sheet tab), the unconsumed keystroke leaked to the global
      // handler and deleted a dataset the pane may not even display
      // (GUI_INTERACTION #14: a worksheet window can browse a non-active
      // dataset). Own the key; no-op when there's nothing to clear.
      e.preventDefault();
      if (view.blockOps.hasBlock) view.blockOps.clearBlock();
    }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Without a cell cursor, unconsumed bare arrows on a focused toolbar
      // button/sheet tab stepped the GLOBAL active-dataset list
      // (retrospective audit). Consume them.
      e.preventDefault();
    }
  };

  return (
    <div className="qzk-sheet" onKeyDown={onKeyDown} tabIndex={-1} ref={rootRef}>
      <WorksheetToolbar
        formula={view.formula}
        colName={view.colName}
        setFormula={view.setFormula}
        setColName={view.setColName}
        onAddColumn={view.addColumn}
        addColumnPending={view.addColumnPending}
        showStats={view.showStats}
        onToggleStats={() => view.setShowStats((v) => !v)}
        onCopy={view.copyRows}
        onExport={() => exportSheet(ds, view.order.filter((r) => view.selected.has(r)))}
        blockOps={cursor.blockOps}
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
        onOpenInGraphBuilder={view.openSelectionInGraphBuilder}
        onAnalyzeSelection={view.openSelectionInAnalysisCenter}
        onClearColSelection={view.clearColSelection}
        plotLinked={view.plotLinked}
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
      <DerivedWorksheetBanner ds={ds} />
      {ds.pending && !failedReason && (
        <div className="qzk-ds-meta" style={{ padding: "4px 8px", color: "var(--text-faint)" }}>
          Loading full data ({ds.pending.rows} rows × {ds.pending.cols} channels) — showing a preview
          for now.
        </div>
      )}
      {ds.pending && failedReason && (
        <div className="qzk-ds-meta" role="status" style={{ padding: "4px 8px", color: "var(--danger)" }}>
          Could not load the full data ({ds.pending.rows} rows × {ds.pending.cols} channels): {truncateReason(failedReason)}. Showing
          the preview rows only; re-import the file to load the rest.
        </div>
      )}
      {view.err && (
        <div className="qzk-ds-meta" role="alert" style={{ padding: "4px 8px", color: "var(--danger)", whiteSpace: "normal" }}>
          {view.err}
        </div>
      )}
      {reveal.notice && (
        <div className="qzk-ds-meta" style={{ padding: "4px 8px", color: "var(--text-faint)" }}>
          {reveal.notice}
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
        columnDesignations={ds.columnDesignations}
        sortMark={view.sortMark}
        selectedCols={view.selectedCols}
        // A row-number or header click switches to whole-line selection.
        onToggleColSelect={(c) => (cursor.clear(), view.toggleColSelected(c))}
        onSelectColRange={(cols) => (cursor.clear(), view.setColSelection(cols))}
        onToggleSelect={(r) => (cursor.clear(), view.toggleRowSelected(r))}
        onSelectRange={(rows) => (cursor.clear(), view.setRowSelection(rows))}
        onEditCell={view.onEditCell}
        onEditCategoricalCell={(row, col, label) => useApp.getState().setCategoricalCell(ds.id, row, col, label)}
        baseCount={view.baseCount}
        onRemoveFormula={view.onRemoveFormula}
        formulaErrors={ds.formulaErrors}
        showStats={view.showStats}
        colStats={view.colStats}
        statsErr={view.statsErr}
        onHeaderContext={openMenu("col")}
        onTextHeaderContext={(name, e) => {
          e.preventDefault();
          setMenu({ kind: "text", name, x: e.clientX, y: e.clientY });
        }}
        onRowContext={openMenu("row")}
        textCols={view.textCols}
        colWidths={view.colWidths}
        onResizeCol={view.setColWidth}
        onAutofitCol={view.autofitCol}
        modelingTypeOf={(col) => channelModelingType(ds, col)}
        channelTypes={ds.channelTypes}
        onChangeChannelType={(col, t) => useApp.getState().setChannelType(ds.id, col, t)}
        readOnly={isRederived(ds) && rederivedNotice(ds)}
        reveal={(rowRevealFirst ? reveal.target : cursor.reveal) ?? reveal.target}
        cursor={cursor.grid}
        columnProps={ds.columnProps}
        onHeaderDoubleClick={isRederived(ds) ? undefined : (col) => editHeader(col)}
      />

      <WorksheetMenus
        ds={ds}
        view={view}
        menu={menu}
        onClose={() => setMenu(null)}
        onEditHeader={editHeader}
      />
      {headerEdit && (
        <HeaderEditor
          key={headerEdit.col}
          ds={ds}
          target={headerEdit}
          xName={view.xName}
          xUnit={view.xUnit}
          onClose={closeHeaderEdit}
        />
      )}


      <SheetTabs datasetId={ds.id} />
    </div>
  );
}
