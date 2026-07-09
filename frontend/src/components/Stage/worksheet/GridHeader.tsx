// The worksheet grid's header row (WORKSHEET_PLAN items 2 + 4): the
// row-number corner + x column (both pinned — sticky left, like the gutter),
// then the windowed slice of value/computed-column headers. Each header cell
// shows the label, its role line (channel letter / user role / Origin
// designation badge — item 4), a truncated Origin comment line (full text in
// the tooltip), a sort mark, and — for computed (formula) columns — a remove
// button. Presentational + a context-menu hook; all state lives in the
// worksheet view hook.

import { columnMetaList, DESIGNATION_BADGE, type ColumnMeta } from "../../../lib/columnmeta";
import { channelLetter } from "../../../lib/formula";
import type { ChannelRole, DataStruct } from "../../../lib/types";

export interface GridHeaderProps {
  data: DataStruct;
  xName: string;
  xUnit: string;
  channelRoles: Record<number, ChannelRole>;
  /** Channels at index >= baseCount are computed (formula) columns. */
  baseCount: number;
  visibleCols: number[];
  leadingSpacer: number;
  trailingSpacer: number;
  colWidth: number;
  gutterWidth: number;
  sortMark: (col: number) => string;
  onToggleSort: (col: number) => void;
  onRemoveFormula: (index: number) => void;
  onHeaderContext?: (col: number, e: React.MouseEvent) => void;
}

/** True short-name-aware role badge for one value channel: computed columns
 *  always show "ƒx"; an explicit channelRole (label/ignore) always wins next
 *  (a stronger, user-set signal); otherwise an Origin designation badge
 *  stands in for the bare formula-engine letter when one is decoded (item 4
 *  — the letter can disagree with Origin's own short name once an early
 *  column is consumed as X); plain data falls back to the letter, unchanged
 *  from before item 4. */
function roleText(
  col: number,
  computed: boolean,
  role: ChannelRole | undefined,
  meta: ColumnMeta | undefined,
): string {
  if (computed) return "ƒx";
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
  baseCount,
  visibleCols,
  leadingSpacer,
  trailingSpacer,
  colWidth,
  gutterWidth,
  sortMark,
  onToggleSort,
  onRemoveFormula,
  onHeaderContext,
}: GridHeaderProps) {
  const colMeta = columnMetaList(data);

  return (
    <div className="qzk-grid-row qzk-grid-header" role="row" style={{ position: "sticky", top: 0, zIndex: 3 }}>
      <div
        role="columnheader"
        className="qzk-grid-headcell qzk-grid-rownum"
        style={{ position: "sticky", left: 0, zIndex: 4, width: gutterWidth, flexShrink: 0 }}
      >
        #
      </div>
      <div
        role="columnheader"
        className="qzk-grid-headcell"
        style={{ position: "sticky", left: gutterWidth, zIndex: 4, width: colWidth, flexShrink: 0 }}
        onClick={() => onToggleSort(-1)}
        onContextMenu={onHeaderContext ? (e) => onHeaderContext(-1, e) : undefined}
      >
        {xName}
        <span className="role">
          X{xUnit ? ` · ${xUnit}` : ""}
          {sortMark(-1)}
        </span>
      </div>
      {leadingSpacer > 0 && <div style={{ width: leadingSpacer, flexShrink: 0 }} aria-hidden="true" />}
      {visibleCols.map((c) => {
        const computed = c >= baseCount;
        const meta = colMeta[c];
        const dimmed = Boolean(channelRoles[c]) || meta?.designation === "Label" || meta?.designation === "Disregard";
        return (
          <div
            key={data.labels[c]}
            role="columnheader"
            className="qzk-grid-headcell"
            style={{ width: colWidth, flexShrink: 0, opacity: dimmed ? 0.55 : 1 }}
            onClick={() => onToggleSort(c)}
            onContextMenu={onHeaderContext ? (e) => onHeaderContext(c, e) : undefined}
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
            <span className="role">
              {roleText(c, computed, channelRoles[c], meta)}
              {data.units[c] ? ` · ${data.units[c]}` : ""}
              {sortMark(c)}
            </span>
            {meta?.comment && (
              <span className="comment" title={meta.comment}>
                {meta.comment}
              </span>
            )}
          </div>
        );
      })}
      {trailingSpacer > 0 && <div style={{ width: trailingSpacer, flexShrink: 0 }} aria-hidden="true" />}
    </div>
  );
}
