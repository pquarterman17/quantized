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

import { categoricalLevels } from "../../../lib/categorical";
import type { TextColumn } from "../../../lib/originTextColumns";
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
  revealScrollOffset,
  windowIndices,
} from "../../../lib/gridwindow";
import type { OriginDesignation } from "../../../lib/columnmeta";
import type { ColumnProps } from "../../../lib/columnProps";
import type { CalcResult, ChannelRole, DataStruct, ModelingType } from "../../../lib/types";
import GridHeader from "./GridHeader";
import { gridFormatters } from "./cellFormat";
import GridRow, { type GridRowCursor } from "./GridRow";
import GridStatsFooter from "./GridStatsFooter";
import { useCellEdit, type CellEditApi } from "./useCellEdit";
import { useLineSelect } from "./useLineSelect";
import { useColResize } from "./useColResize";

const DATE_X_COL_WIDTH = 168; // px: a full "YYYY-MM-DD HH:MM:SS" in the mono cell font

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
  /** The user's "Set As" overrides, for the header badges (GridHeader). */
  columnDesignations?: Record<number, OriginDesignation>;
  sortMark: (col: number) => string;
  selectedCols: Set<number>;
  onToggleColSelect: (col: number) => void;
  onSelectColRange: (cols: number[]) => void;
  onToggleSelect: (r: number) => void;
  onSelectRange: (rows: number[]) => void;
  onEditCell: (row: number, col: number, value: number) => void;
  /** P1.6b item 7: commit a categorical cell's picked/typed LABEL — see
   *  GridRow's doc for why this is separate from `onEditCell`. Optional; a
   *  categorical column still displays/edits via the plain numeric path
   *  when omitted (every pre-existing caller/test). */
  onEditCategoricalCell?: (row: number, col: number, label: string) => void;
  /** Channels at index >= baseCount are computed (formula) columns. */
  baseCount: number;
  onRemoveFormula: (index: number) => void;
  /** PR K (K5b): per-column error state for a failing computed column, keyed
   *  by name (`Dataset.formulaErrors`) — surfaced as a header badge. */
  formulaErrors?: Record<string, string>;
  showStats: boolean;
  colStats: (CalcResult | null)[] | null;
  statsErr: boolean;
  onHeaderContext?: (col: number, e: React.MouseEvent) => void;
  onTextHeaderContext?: (name: string, e: React.MouseEvent) => void;
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
  /** P1.6b item 6 — see GridHeader's own doc for what each does; all three
   *  optional together (omitting hides the badge, matching every existing
   *  caller/test). */
  modelingTypeOf?: (col: number) => ModelingType;
  channelTypes?: Record<number, ModelingType>;
  onChangeChannelType?: (col: number, t: ModelingType | null) => void;
  /** Every cell is read-only: the dataset is re-derived by the recalc (lib/rederived.ts). */
  readOnly?: boolean | string;
  /** Scroll a DISPLAY row (index into `order`) — and a column, if given — into
   *  view, once per `key` (see ./useRowReveal.ts). */
  reveal?: GridReveal | null;
  /** The cell cursor (./useGridCursor.ts): omitted, the grid has none and
   *  edits on double-click only (every pre-cursor caller/test). */
  cursor?: GridCursorProps;
  /** User display formats per column (`Dataset.columnProps`). */
  columnProps?: Record<number, ColumnProps>;
  /** Double-click a header: the Long Name / Units / Comments editor. */
  onHeaderDoubleClick?: (col: number, e: React.MouseEvent) => void;
}

/** What the cursor hook hands the grid: the per-cell marks and handlers
 *  (GridRow's `cursor`, minus the row position the grid supplies), the shared
 *  cell editor, the grid's ARIA wiring, and the blank entry row. */
export interface GridCursorProps extends Omit<GridRowCursor, "pos"> {
  cellEdit: CellEditApi;
  gridId: string;
  label: string;
  activeCellId?: string;
  /** Show the blank entry row under the data (original index below). */
  entryRow: boolean;
  entryRowIndex: number;
}

export interface GridReveal {
  pos: number;
  /** A channel index, or a text column's short name. */
  column?: number | string;
  key: number;
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
  columnDesignations,
  sortMark,
  selectedCols,
  onToggleColSelect,
  onSelectColRange,
  onToggleSelect,
  onSelectRange,
  onEditCell,
  onEditCategoricalCell,
  baseCount,
  onRemoveFormula,
  formulaErrors,
  showStats,
  colStats,
  statsErr,
  onHeaderContext,
  onTextHeaderContext,
  onRowContext,
  textCols,
  colWidths = {},
  onResizeCol = () => {},
  onAutofitCol = () => {},
  modelingTypeOf,
  channelTypes,
  onChangeChannelType,
  readOnly,
  reveal,
  cursor,
  columnProps,
  onHeaderDoubleClick,
}: GridViewportProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [metrics, setMetrics] = useState({ width: 0, height: 0, rowHeight: DEFAULT_ROW_HEIGHT });
  const { onRowNumClick, onHeaderClick } = useLineSelect(
    order,
    { toggle: onToggleSelect, range: onSelectRange },
    { toggle: onToggleColSelect, range: onSelectColRange },
  );
  const xIsDate = data.metadata?.time_is_datetime === true; // audit #7: a date X shows and edits as dates
  const ownCellEdit = useCellEdit(onEditCell, undefined, xIsDate);
  const cellEdit = cursor?.cellEdit ?? ownCellEdit;
  // Per-column number precision: each drawn column is scanned once per data change.
  // A column with a user display format (Column Properties) uses that instead.
  const fmtOf = useMemo(() => gridFormatters(data.time, data.values, columnProps, xIsDate), [data.time, data.values, columnProps, xIsDate]);

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
  // A date X needs room for "2026-03-01 12:00:00" (audit #7) until the user sizes it.
  const widthOf = (c: number) => colWidths[c] ?? (c < 0 && xIsDate ? DATE_X_COL_WIDTH : colWidth);
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

  // Reveal (store/worksheetReveal.ts): scroll once per request key. Reads the
  // live element — rows sit under the sticky header, and the gutter
  // + x column are pinned — then mirrors the result into `scroll` so the window
  // moves this render, not after the browser's async scroll event.
  const revealed = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !reveal || revealed.current === reveal.key) return;
    revealed.current = reveal.key;
    const rh = readRowHeight(el);
    const headerH = (el.firstElementChild as HTMLElement | null)?.offsetHeight || rh;
    const top = revealScrollOffset(reveal.pos * rh, rh, el.scrollTop, el.clientHeight - headerH, true);
    const c = reveal.column;
    const text = typeof c === "string" ? textCols.findIndex((t) => t.shortName === c) : -1;
    const at = (i: number) => (colOffsets ? colOffsets[i] : i * colWidth);
    const value = typeof c === "number" && c >= 0 && c < colCount;
    const start = text >= 0 ? at(colCount) + text * colWidth : value ? at(c) : null;
    const size = (value && colWidths[c]) || colWidth;
    const avail = el.clientWidth - gutterWidth - (colWidths[-1] ?? (xIsDate ? DATE_X_COL_WIDTH : colWidth));
    const left = start == null ? el.scrollLeft : revealScrollOffset(start, size, el.scrollLeft, avail, false);
    el.scrollTop = top;
    el.scrollLeft = left;
    setScroll({ top, left });
  }, [reveal, textCols, colCount, colWidth, colWidths, gutterWidth, colOffsets, xIsDate]);

  const rowCount = order.length + (cursor?.entryRow ? 1 : 0);
  const rowWindow = computeAxisWindow(scroll.top, metrics.height, rowCount, {
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

  const visibleRows = order.slice(rowWindow.start, Math.min(rowWindow.end, order.length));
  const visibleCols = windowIndices(colWindow);
  const leadingRowSpacer = rowWindow.offset;
  const trailingRowSpacer = (rowCount - rowWindow.end) * metrics.rowHeight;
  const leadingColSpacer = colWindow.offset;
  const trailingColSpacer = colOffsets
    ? colWindow.totalSize - colOffsets[colWindow.end]
    : (colCount - colWindow.end) * colWidth;

  // The blank entry row (cursor.entryRow) renders at display position
  // `order.length`, past every data row; it has no original row yet.
  const entryPos = order.length;
  const rowAt = (pos: number, r: number, entry: boolean) => (
    <GridRow
      key={entry ? "entry" : r}
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
      readOnly={readOnly}
      textCols={textCols}
      catLevels={(col) => categoricalLevels(data, col)}
      onEditCategoricalCell={onEditCategoricalCell}
      onEditCell={onEditCell}
      colName={(col) => (col < 0 ? xName : data.labels[col] ?? `column ${col + 1}`)}
      fmtOf={fmtOf}
      cursor={cursor && { pos, ...cursor }}
      entry={entry}
    />
  );

  return (
    <div
      className="qzk-grid"
      ref={scrollRef}
      onScroll={onScroll}
      role="grid"
      id={cursor?.gridId}
      aria-label={cursor?.label}
      aria-multiselectable={cursor ? true : undefined}
      aria-activedescendant={cursor?.activeCellId}
      tabIndex={cursor ? 0 : undefined}
    >
      <GridHeader
        data={data}
        xName={xName}
        xUnit={xUnit}
        channelRoles={channelRoles}
        columnDesignations={columnDesignations}
        baseCount={baseCount}
        formulaErrors={formulaErrors}
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
        onTextHeaderContext={onTextHeaderContext}
        textCols={textCols}
        modelingTypeOf={modelingTypeOf}
        channelTypes={channelTypes}
        onChangeChannelType={onChangeChannelType}
        onHeaderDoubleClick={onHeaderDoubleClick}
        commentOf={(c) => columnProps?.[c]?.comment}
      />
      {leadingRowSpacer > 0 && <div style={{ height: leadingRowSpacer }} aria-hidden="true" />}
      {visibleRows.map((r, i) => rowAt(rowWindow.start + i, r, false))}
      {cursor?.entryRow && rowWindow.end > entryPos && rowAt(entryPos, cursor.entryRowIndex, true)}
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
