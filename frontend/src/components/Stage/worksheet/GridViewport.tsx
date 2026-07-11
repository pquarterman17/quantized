// The worksheet's virtualized data grid (WORKSHEET_PLAN item 2): kills the old
// WorksheetTable's `MAX_ROWS = 500` cap with a hand-rolled, div-based ARIA
// grid. Fixed row height (read once from the `--row-h` density token) +
// uniform column width (key decision 1) let lib/gridwindow compute the
// visible-plus-overscan row/column range from pure arithmetic — no per-item
// measurement. A leading + trailing spacer on each axis (in normal document
// flow, no absolute positioning) keeps the scroll container's native content
// size correct regardless of where the window currently sits; the row-number
// gutter and x column are pinned via `position: sticky` alongside the sticky
// header row, the same mechanism the old `<table><th>` used, just applied per
// cell instead of relying on `<thead>`. jsdom measures a 0-size viewport, so
// `computeAxisWindow`'s degenerate fallback renders a generous fixed window —
// every existing test dataset (a handful of rows/columns) still renders in
// full (key decision 2).
//
// Column-selection click handling (item 6) mirrors the row-number click
// handler below exactly: a local `colAnchor` tracks the last plain/ctrl click
// for shift-range extension. Text columns (item 8) are unvirtualized —
// appended once, in full, past the numeric window on every axis (header/row/
// footer), never part of the row/column windowing math.

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { TextColumn } from "../../../lib/columnmeta";
import {
  buildOffsets,
  computeAxisWindow,
  computeAxisWindowOffsets,
  DEFAULT_COL_OVERSCAN,
  DEFAULT_COL_WIDTH,
  DEFAULT_FALLBACK_COLS,
  DEFAULT_FALLBACK_ROWS,
  DEFAULT_GUTTER_WIDTH,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_ROW_OVERSCAN,
  windowIndices,
} from "../../../lib/gridwindow";
import type { CalcResult, ChannelRole, DataStruct } from "../../../lib/types";
import GridHeader from "./GridHeader";
import GridRow from "./GridRow";
import GridStatsFooter from "./GridStatsFooter";
import { useCellEdit } from "./useCellEdit";
import { useColResize } from "./useColResize";

export interface GridViewportProps {
  data: DataStruct;
  xName: string;
  xUnit: string;
  /** Display order (post local-filter + sort) of ORIGINAL row indices. */
  order: number[];
  masked: Set<number>;
  filteredOut: Set<number>;
  selected: Set<number>;
  channelRoles: Record<number, ChannelRole>;
  sortMark: (col: number) => string;
  selectedCols: Set<number>;
  onToggleColSelect: (col: number) => void;
  onSelectColRange: (cols: number[]) => void;
  onToggleSelect: (r: number) => void;
  onSelectRange: (rows: number[]) => void;
  onEditCell: (row: number, col: number, value: number) => void;
  /** Channels at index >= baseCount are computed (formula) columns. */
  baseCount: number;
  onRemoveFormula: (index: number) => void;
  showStats: boolean;
  colStats: (CalcResult | null)[] | null;
  statsErr: boolean;
  onHeaderContext?: (col: number, e: React.MouseEvent) => void;
  onRowContext?: (row: number, e: React.MouseEvent) => void;
  /** Read-only Origin text columns (item 8) — see module doc above. */
  textCols: TextColumn[];
  /** Per-column width overrides (MAIN_PLAN #3), keyed by column index (-1 =
   *  the pinned x column). Session state, owned by useWorksheetView; empty →
   *  the uniform-width fast path (windowing is one divide, no offsets). */
  colWidths?: Record<number, number>;
  /** Live width update during a header-edge drag. */
  onResizeCol?: (col: number, width: number) => void;
  /** Double-click a header edge: autofit the column to a content sample. */
  onAutofitCol?: (col: number) => void;
}

/** The row height token, read once per mount (and on resize, in case a
 *  density change re-runs it) — falls back to a fixed default when the token
 *  isn't defined (a bare test render with no stylesheet loaded). */
function readRowHeight(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue("--row-h");
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ROW_HEIGHT;
}

export default function GridViewport({
  data,
  xName,
  xUnit,
  order,
  masked,
  filteredOut,
  selected,
  channelRoles,
  sortMark,
  selectedCols,
  onToggleColSelect,
  onSelectColRange,
  onToggleSelect,
  onSelectRange,
  onEditCell,
  baseCount,
  onRemoveFormula,
  showStats,
  colStats,
  statsErr,
  onHeaderContext,
  onRowContext,
  textCols,
  colWidths = {},
  onResizeCol = () => {},
  onAutofitCol = () => {},
}: GridViewportProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [metrics, setMetrics] = useState({ width: 0, height: 0, rowHeight: DEFAULT_ROW_HEIGHT });
  // Anchor row for shift-click range selection (an original row index).
  const [anchor, setAnchor] = useState<number | null>(null);
  // Anchor COLUMN for shift-click range selection (item 6) — same pattern,
  // one axis over. -1 (the pinned x/time column) is a valid anchor.
  const [colAnchor, setColAnchor] = useState<number | null>(null);
  const cellEdit = useCellEdit(onEditCell);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setMetrics({ width: el.clientWidth, height: el.clientHeight, rowHeight: readRowHeight(el) });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScroll({ top: el.scrollTop, left: el.scrollLeft });
  };

  const colWidth = DEFAULT_COL_WIDTH;
  const gutterWidth = DEFAULT_GUTTER_WIDTH;
  const colCount = data.labels.length;
  // Per-column width resolution (MAIN_PLAN #3): resized columns override the
  // uniform default; -1 (the pinned x column) is resizable too.
  const widthOf = (c: number) => colWidths[c] ?? colWidth;
  const colResize = useColResize(widthOf, onResizeCol);
  // Any VALUE column resized? (An x-only resize doesn't affect the scrolling
  // axis — it just widens the pinned cell — so the fast path still applies.)
  const hasCustomCols = useMemo(
    () => Object.keys(colWidths).some((k) => Number(k) >= 0),
    [colWidths],
  );
  // Prefix-sum column offsets, built ONLY when some value column was resized
  // (the uniform fast path needs no array at all) and rebuilt only when the
  // widths/count change — a resize updates ONE array + the windowed slice,
  // never the full grid (the perf tests measure this).
  const colOffsets = useMemo(
    () => (hasCustomCols ? buildOffsets(colCount, (c) => colWidths[c] ?? DEFAULT_COL_WIDTH) : null),
    [hasCustomCols, colCount, colWidths],
  );

  const rowWindow = computeAxisWindow(scroll.top, metrics.height, order.length, {
    itemSize: metrics.rowHeight,
    overscan: DEFAULT_ROW_OVERSCAN,
    fallbackCount: DEFAULT_FALLBACK_ROWS,
  });
  // The gutter + x column are pinned, so only the remaining width actually
  // scrolls the value/computed columns.
  const availableColWidth = Math.max(0, metrics.width - gutterWidth - widthOf(-1));
  const colWindow = colOffsets
    ? computeAxisWindowOffsets(scroll.left, availableColWidth, colOffsets, {
        overscan: DEFAULT_COL_OVERSCAN,
        fallbackCount: DEFAULT_FALLBACK_COLS,
      })
    : computeAxisWindow(scroll.left, availableColWidth, colCount, {
        itemSize: colWidth,
        overscan: DEFAULT_COL_OVERSCAN,
        fallbackCount: DEFAULT_FALLBACK_COLS,
      });

  const visibleRows = order.slice(rowWindow.start, rowWindow.end);
  const visibleCols = windowIndices(colWindow);
  const leadingRowSpacer = rowWindow.offset;
  const trailingRowSpacer = (order.length - rowWindow.end) * metrics.rowHeight;
  const leadingColSpacer = colWindow.offset;
  const trailingColSpacer = colOffsets
    ? colWindow.totalSize - colOffsets[colWindow.end]
    : (colCount - colWindow.end) * colWidth;

  // Row-number click: plain click toggles the row into the selection; a
  // shift-click extends from the last-clicked anchor across the DISPLAYED
  // (post-filter/sort) rows between the two clicks.
  const onRowNumClick = (r: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor != null) {
      const aPos = order.indexOf(anchor);
      const pos = order.indexOf(r);
      if (aPos >= 0 && pos >= 0) {
        const [lo, hi] = aPos <= pos ? [aPos, pos] : [pos, aPos];
        onSelectRange(order.slice(lo, hi + 1));
        return;
      }
    }
    onToggleSelect(r);
    setAnchor(r);
  };

  // Header click: plain click selects ONLY that column (replaces the
  // selection); ctrl/cmd-click toggles it into a multi-selection; shift-click
  // extends a range from the last-clicked anchor. Column indices are stable
  // (channel order, not DOM position), so the selection survives scrolling.
  const onHeaderClick = (col: number, e: React.MouseEvent) => {
    if (e.shiftKey && colAnchor != null) {
      const [lo, hi] = colAnchor <= col ? [colAnchor, col] : [col, colAnchor];
      const range: number[] = [];
      for (let c = lo; c <= hi; c++) range.push(c);
      onSelectColRange(range);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      onToggleColSelect(col);
      setColAnchor(col);
      return;
    }
    onSelectColRange([col]);
    setColAnchor(col);
  };

  return (
    <div className="qzk-grid" ref={scrollRef} onScroll={onScroll} role="grid">
      <GridHeader
        data={data}
        xName={xName}
        xUnit={xUnit}
        channelRoles={channelRoles}
        baseCount={baseCount}
        visibleCols={visibleCols}
        leadingSpacer={leadingColSpacer}
        trailingSpacer={trailingColSpacer}
        colWidth={colWidth}
        widthOf={widthOf}
        gutterWidth={gutterWidth}
        sortMark={sortMark}
        selectedCols={selectedCols}
        onHeaderClick={onHeaderClick}
        onResizeStart={colResize.startResize}
        onAutofitCol={onAutofitCol}
        onRemoveFormula={onRemoveFormula}
        onHeaderContext={onHeaderContext}
        textCols={textCols}
      />
      {leadingRowSpacer > 0 && <div style={{ height: leadingRowSpacer }} aria-hidden="true" />}
      {visibleRows.map((r) => (
        <GridRow
          key={r}
          r={r}
          time={data.time}
          values={data.values}
          visibleCols={visibleCols}
          leadingSpacer={leadingColSpacer}
          trailingSpacer={trailingColSpacer}
          colWidth={colWidth}
          widthOf={widthOf}
          gutterWidth={gutterWidth}
          rowHeight={metrics.rowHeight}
          baseCount={baseCount}
          isMasked={masked.has(r)}
          isFilteredOut={!masked.has(r) && filteredOut.has(r)}
          isSelected={selected.has(r)}
          selectedCols={selectedCols}
          onRowNumClick={onRowNumClick}
          onRowContext={onRowContext}
          cellEdit={cellEdit}
          textCols={textCols}
        />
      ))}
      {trailingRowSpacer > 0 && <div style={{ height: trailingRowSpacer }} aria-hidden="true" />}
      {showStats && (
        <GridStatsFooter
          channelRoles={channelRoles}
          colStats={colStats}
          statsErr={statsErr}
          visibleCols={visibleCols}
          leadingSpacer={leadingColSpacer}
          trailingSpacer={trailingColSpacer}
          colWidth={colWidth}
          widthOf={widthOf}
          gutterWidth={gutterWidth}
          rowHeight={metrics.rowHeight}
          textCols={textCols}
        />
      )}
    </div>
  );
}
