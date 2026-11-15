// The worksheet grid's header row (WORKSHEET_PLAN items 2 + 4 + 6 + 8): the
// row-number corner + x column (both pinned — sticky left, like the gutter),
// then the windowed slice of value/computed-column headers, interleaved with
// any read-only Origin text columns at THEIR OWN position in the file's
// column order (worksheet audit follow-up — `textLayout`, textColumns.ts's
// `layoutTextColumns`; a text column the grid can't place precisely, because
// its anchor channel is scrolled out of the current window, falls back to
// the trailing position it always rendered at before this). Each numeric
// header cell shows the label, its role line (channel letter /
// user role / Origin designation badge — item 4), a truncated Origin comment
// line (full text in the tooltip), a sort mark, and — for computed (formula)
// columns — a remove button.
//
// Column-selection gesture (item 6, owner decision D1): a header CLICK
// selects the column (ctrl/cmd-click toggles it into a multi-selection,
// shift-click extends a range from the last-clicked column) — sorting moved
// OFF the click gesture entirely and lives in the column context menu
// (worksheetMenuModel.columnMenuItems' "Sort ascending"/"Sort descending",
// unchanged) plus the `sortMark` indicator already shown in the role line.
// This is the ONE sanctioned worksheet behaviour change (WORKSHEET_PLAN item
// 6) — Origin's own muscle memory is header-click-selects, and highlighting
// columns is the gesture item 7's "plot the selection" feeds off of. The
// click-modifier bookkeeping (anchor tracking for shift-range) lives in
// GridViewport, mirroring the existing row-number click handler exactly.
//
// Text columns (item 8) get no click handler at all — read-only, never a
// sort/selection/plot candidate (they have no `.values` channel index).
//
// Column resize (MAIN_PLAN #3): every numeric header cell (x + value/computed
// columns; not text columns) carries a right-edge drag handle — drag resizes
// (pointer bookkeeping in useColResize, width state in useWorksheetView),
// double-click autofits to a content sample. Handles stopPropagation so the
// select-click gesture above never fires from a resize.

import { Fragment } from "react";

import { columnMetaList, type ColumnMeta, type OriginDesignation } from "../../../lib/columnmeta";
import { DESIGNATION_BADGE, type TextColumn } from "../../../lib/originTextColumns";
import { userParamRows, userParamValue } from "../../../lib/userParams";
import { channelLetter } from "../../../lib/formula";
import type { ChannelRole, DataStruct, ModelingType } from "../../../lib/types";
import ColumnTypeSelect from "./ColumnTypeSelect";
import HiddenColumnsMarker from "./HiddenColumnsMarker";
import type { TextColumnLayout } from "./textColumns";
import type { ColumnAria } from "../../../lib/worksheetColumnView";

export interface GridHeaderProps {
  data: DataStruct;
  xName: string;
  xUnit: string;
  channelRoles: Record<number, ChannelRole>;
  /** The user's "Set As" overrides (`Dataset.columnDesignations`); a badge
   *  shows the EFFECTIVE designation (lib/columnmeta.ts's effectiveDesignations). */
  columnDesignations?: Record<number, OriginDesignation>;
  /** Channels at index >= baseCount are computed (formula) columns. */
  baseCount: number;
  visibleCols: number[];
  leadingSpacer: number;
  trailingSpacer: number;
  colWidth: number;
  /** Per-column width (MAIN_PLAN #3); -1 = the pinned x column. Text columns
   *  keep the uniform `colWidth`. */
  widthOf: (col: number) => number;
  gutterWidth: number;
  sortMark: (col: number) => string;
  selectedCols: Set<number>;
  onHeaderClick: (col: number, e: React.MouseEvent) => void;
  /** Drag handle pointerdown (useColResize.startResize). */
  onResizeStart: (col: number, e: React.PointerEvent) => void;
  /** Double-click the handle: autofit the column to a content sample. */
  onAutofitCol: (col: number) => void;
  onRemoveFormula: (index: number) => void;
  /** PR K (K5b): per-column error state for a failing computed column, keyed
   *  by name — a computed column with an entry here shows a warning badge
   *  instead of the failure staying silent. */
  formulaErrors?: Record<string, string>;
  onHeaderContext?: (col: number, e: React.MouseEvent) => void;
  /** Right-click on a TEXT column's header (its sort menu), by column name. */
  onTextHeaderContext?: (name: string, e: React.MouseEvent) => void;
  /** Read-only Origin text columns (item 8), positioned per the file's own
   *  column order (worksheet audit follow-up) — see textColumns.ts's doc. */
  textLayout: TextColumnLayout;
  /** P1.6b item 6 (worksheet C/O/N visibility): the EFFECTIVE modeling type
   *  per column (override-or-inferred — `lib/modeling.channelModelingType`).
   *  Optional so every existing caller/test (which never rendered a badge)
   *  is unaffected — omitting it hides the badge entirely. */
  modelingTypeOf?: (col: number) => ModelingType;
  /** Per-column user OVERRIDE (absent = auto-inferred) — the select's
   *  controlled value; distinct from `modelingTypeOf`'s EFFECTIVE type so
   *  the select can show "auto·C" vs an explicit "Cont"/"Ord"/"Nom". */
  channelTypes?: Record<number, ModelingType>;
  onChangeChannelType?: (col: number, t: ModelingType | null) => void;
  /** Double-click a header: edit its Long Name / Units / Comments (HeaderEditor). */
  onHeaderDoubleClick?: (col: number, e: React.MouseEvent) => void;
  /** The user's Comments row (`Dataset.columnProps`), over the book's own. */
  commentOf?: (col: number) => string | undefined;
  /** Pinned (frozen) value columns + sticky `left`s, as GridRow. */
  frozenCols?: number[];
  frozenLeft?: (col: number) => number;
  /** Hidden-column runs keyed by the shown column before them (-1 = X): a
   *  marker on that header; clicking it shows the run. */
  hiddenRuns?: Map<number, number[]>;
  onShowCols?: (cols: number[]) => void;
  /** True column numbers (`aria-colindex`) — see GridRow. */
  colPos?: ColumnAria;
}

const NO_FROZEN: number[] = [];
const FROZEN_EDGE = "2px 0 0 var(--accent)"; // where the pinned columns end
/** True short-name-aware role badge for one value channel: computed columns
 *  always show "ƒx"; a user's "Set As" designation wins next (it also wrote
 *  the matching channelRole, so badge and role agree); then an explicit
 *  channelRole (label/ignore) (a stronger, user-set signal); otherwise an
 *  Origin designation badge
 *  stands in for the bare formula-engine letter when one is decoded (item 4
 *  — the letter can disagree with Origin's own short name once an early
 *  column is consumed as X); plain data falls back to the letter, unchanged
 *  from before item 4. */
function roleText(
  col: number,
  computed: boolean,
  role: ChannelRole | undefined,
  meta: ColumnMeta | undefined,
  userSet?: OriginDesignation,
): string {
  if (computed) return "ƒx";
  if (userSet) return DESIGNATION_BADGE[userSet];
  if (role) return role;
  if (meta?.designation) return DESIGNATION_BADGE[meta.designation];
  return channelLetter(col);
}

function headerTitle(
  col: number,
  computed: boolean,
  role: ChannelRole | undefined,
  meta: ColumnMeta | undefined,
): string {
  const base = computed
    ? `${channelLetter(col)} — computed column`
    : role
      ? `${channelLetter(col)} — ${role} column`
      : channelLetter(col);
  return meta?.comment ? `${base}\n${meta.comment}` : base;
}

export default function GridHeader({
  data,
  xName,
  xUnit,
  channelRoles,
  columnDesignations,
  baseCount,
  visibleCols,
  leadingSpacer,
  trailingSpacer,
  colWidth,
  widthOf,
  gutterWidth,
  sortMark,
  selectedCols,
  onHeaderClick,
  onResizeStart,
  onAutofitCol,
  onRemoveFormula,
  formulaErrors,
  onHeaderContext,
  onTextHeaderContext,
  textLayout,
  modelingTypeOf,
  channelTypes,
  onChangeChannelType,
  onHeaderDoubleClick,
  commentOf,
  frozenCols = NO_FROZEN,
  frozenLeft = () => 0,
  hiddenRuns,
  onShowCols,
  colPos,
}: GridHeaderProps) {
  const colMeta = columnMetaList(data);
  // User parameter rows (Temperature, Sample, ...): one "name: value" line per
  // parameter the column has a value for.
  const params = userParamRows(data);
  const paramLines = (col: number) =>
    params.map((p) => {
      const v = userParamValue(params, p.name, col);
      return v ? (
        <span key={p.name} className="comment" title={`${p.name}: ${v}`}>
          {p.name}: {v}
        </span>
      ) : null;
    });
  // The Comments row: the user's own (columnProps), else the book's.
  const comment = (col: number, book: string | undefined) => {
    const text = commentOf?.(col) ?? book;
    return text ? (
      <span className="comment" title={text}>
        {text}
      </span>
    ) : null;
  };
  const selStyle = (selected: boolean): React.CSSProperties =>
    selected ? { background: "var(--accent-soft)", borderBottomColor: "var(--accent)", borderBottomWidth: 2 } : {};

  // The right-edge resize handle (MAIN_PLAN #3). Positioned absolutely inside
  // the header cell (the x cell is sticky, value cells get position:relative
  // inline below — both are positioned, so the handle anchors correctly).
  const resizeHandle = (col: number) => (
    <span
      className="qzk-col-resize"
      role="separator"
      aria-label={`resize column ${col < 0 ? xName : (data.labels[col] ?? String(col))}`}
      title="drag to resize · double-click to autofit"
      onPointerDown={(e) => onResizeStart(col, e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onAutofitCol(col);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );

  const hiddenMarker = (col: number) => (
    <HiddenColumnsMarker run={hiddenRuns?.get(col)} after={col < 0 ? xName : data.labels[col]} labels={data.labels} onShow={onShowCols} />
  );
  // One text-column header cell — rendered at up to three different spots
  // (before every channel, right after a given one, or trailing) depending
  // on `textLayout`, so it's a shared renderer rather than three copies.
  const textHeaderCell = (t: TextColumn) => (
    <div
      key={`text-${t.shortName}`}
      role="columnheader"
      aria-colindex={colPos?.text[t.shortName]}
      className="qzk-grid-headcell"
      style={{ width: colWidth, flexShrink: 0 }}
      title={`${t.longName ? `${t.longName} (${t.shortName})` : t.shortName}${t.unit ? ` [${t.unit}]` : ""} — read-only text column (Origin)`}
      onContextMenu={onTextHeaderContext ? (e) => onTextHeaderContext(t.shortName, e) : undefined}
    >
      {/* Origin names a column by its Long Name, the short name otherwise. */}
      {t.longName ?? t.shortName}
      <span className="role">
        text
        {t.unit && (
          <>
            {" · "}
            <span className="unit">{t.unit}</span>
          </>
        )}
      </span>
    </div>
  );

  const valueHeader = (c: number, pinnedLeft?: number) => {
    const computed = c >= baseCount;
    const meta = colMeta[c];
    const userSet = columnDesignations?.[c];
    const shown = userSet ?? meta?.designation;
    const dimmed = Boolean(channelRoles[c]) || shown === "label" || shown === "disregard";
    return (
      <Fragment key={c}>
        <div
          role="columnheader"
          className="qzk-grid-headcell"
          style={{
            position: pinnedLeft != null ? "sticky" : "relative",
            ...(pinnedLeft != null ? { left: pinnedLeft, zIndex: 4, boxShadow: c === frozenCols[frozenCols.length - 1] ? FROZEN_EDGE : undefined } : {}),
            width: widthOf(c),
            flexShrink: 0,
            opacity: dimmed ? 0.55 : 1,
            ...selStyle(selectedCols.has(c)),
          }}
          onClick={(e) => onHeaderClick(c, e)}
          onContextMenu={onHeaderContext ? (e) => onHeaderContext(c, e) : undefined}
          onDoubleClick={onHeaderDoubleClick && ((e) => onHeaderDoubleClick(c, e))}
          data-col={c}
          aria-colindex={colPos?.value[c]}
          title={headerTitle(c, computed, channelRoles[c], meta)}
        >
          {data.labels[c]}
          {computed && (
            <button
              className="qzk-col-x"
              title="remove computed column"
              aria-label="remove computed column"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFormula(c - baseCount);
              }}
            >
              ×
            </button>
          )}
          {computed && formulaErrors?.[data.labels[c]] && (
            <span className="qzk-formula-err" title={`Formula error: ${formulaErrors[data.labels[c]]}`}>
              ⚠
            </span>
          )}
          <span className="role">
            {roleText(c, computed, channelRoles[c], meta, userSet)}
            {data.units[c] && (
              <>
                {" · "}
                <span className="unit">{data.units[c]}</span>
              </>
            )}
            {sortMark(c)}
          </span>
          {modelingTypeOf && onChangeChannelType && (
            <ColumnTypeSelect
              name={data.labels[c]}
              effective={modelingTypeOf(c)}
              override={channelTypes?.[c]}
              onChange={(t) => onChangeChannelType(c, t)}
            />
          )}
          {comment(c, meta?.comment)}
          {paramLines(c)}
          {hiddenMarker(c)}
          {resizeHandle(c)}
        </div>
        {pinnedLeft == null && textLayout.after(c).map(textHeaderCell)}
      </Fragment>
    );
  };

  return (
    <div className="qzk-grid-row qzk-grid-header" role="row" style={{ position: "sticky", top: 0, zIndex: 3 }}>
      <div
        role="columnheader"
        className="qzk-grid-headcell qzk-grid-rownum"
        style={{ position: "sticky", left: 0, zIndex: 4, width: gutterWidth, flexShrink: 0 }}
        aria-colindex={colPos ? 1 : undefined}
      >
        #
      </div>
      <div
        role="columnheader"
        className="qzk-grid-headcell"
        style={{ position: "sticky", left: gutterWidth, zIndex: 4, width: widthOf(-1), flexShrink: 0, ...selStyle(selectedCols.has(-1)) }}
        onClick={(e) => onHeaderClick(-1, e)}
        onContextMenu={onHeaderContext ? (e) => onHeaderContext(-1, e) : undefined}
        onDoubleClick={onHeaderDoubleClick && ((e) => onHeaderDoubleClick(-1, e))}
        data-col={-1}
        aria-colindex={colPos ? 2 : undefined}
      >
        {xName}
        <span className="role">
          X
          {xUnit && (
            <>
              {" · "}
              <span className="unit">{xUnit}</span>
            </>
          )}
          {sortMark(-1)}
        </span>
        {comment(-1, undefined)}
        {hiddenMarker(-1)}
        {resizeHandle(-1)}
      </div>
      {textLayout.before.map(textHeaderCell)}
      {frozenCols.map((c) => valueHeader(c, frozenLeft(c)))}
      {frozenCols.length > 0 && textLayout.after(frozenCols[frozenCols.length - 1]).map(textHeaderCell)}
      {leadingSpacer > 0 && <div style={{ width: leadingSpacer, flexShrink: 0 }} aria-hidden="true" />}
      {visibleCols.map((c) => valueHeader(c))}
      {trailingSpacer > 0 && <div style={{ width: trailingSpacer, flexShrink: 0 }} aria-hidden="true" />}
      {textLayout.trailing.map(textHeaderCell)}
    </div>
  );
}
