// The worksheet grid's header row (WORKSHEET_PLAN item 2): the row-number
// corner + x column (both pinned — sticky left, like the gutter), then the
// windowed slice of value/computed-column headers. Each header cell shows the
// label, its role line (channel letter or user role), a sort mark, and — for
// computed (formula) columns — a remove button. Presentational + a
// context-menu hook; all state lives in the worksheet view hook.

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
        return (
          <div
            key={data.labels[c]}
            role="columnheader"
            className="qzk-grid-headcell"
            style={{ width: colWidth, flexShrink: 0, opacity: channelRoles[c] ? 0.55 : 1 }}
            onClick={() => onToggleSort(c)}
            onContextMenu={onHeaderContext ? (e) => onHeaderContext(c, e) : undefined}
            title={
              computed
                ? `${channelLetter(c)} — computed column`
                : channelRoles[c]
                  ? `${channelLetter(c)} — ${channelRoles[c]} column`
                  : channelLetter(c)
            }
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
              {computed ? "ƒx" : (channelRoles[c] ?? channelLetter(c))}
              {data.units[c] ? ` · ${data.units[c]}` : ""}
              {sortMark(c)}
            </span>
          </div>
        );
      })}
      {trailingSpacer > 0 && <div style={{ width: trailingSpacer, flexShrink: 0 }} aria-hidden="true" />}
    </div>
  );
}
