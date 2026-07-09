// One worksheet grid data row (WORKSHEET_PLAN item 2): the row-number gutter
// (pinned, click to select / shift-click a range / right-click to mask), the
// pinned x cell, then the windowed slice of value/computed cells. Double-click
// a cell to edit (Enter/blur commits, Escape cancels via `cellEdit`);
// computed (formula) columns are read-only. Mask (#50) / global-filter (#53) /
// selection styling is applied from booleans the container derives via
// lib/rowstate ONLY — this component just renders what it's handed.

import type { CellEditApi } from "./useCellEdit";

export interface GridRowProps {
  r: number; // original row index
  time: number[];
  values: number[][];
  visibleCols: number[];
  leadingSpacer: number;
  trailingSpacer: number;
  colWidth: number;
  gutterWidth: number;
  rowHeight: number;
  baseCount: number;
  isMasked: boolean;
  isFilteredOut: boolean;
  isSelected: boolean;
  onRowNumClick: (r: number, e: React.MouseEvent) => void;
  onRowContext?: (row: number, e: React.MouseEvent) => void;
  cellEdit: CellEditApi;
}

function fmt(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(4);
}

export default function GridRow({
  r,
  time,
  values,
  visibleCols,
  leadingSpacer,
  trailingSpacer,
  colWidth,
  gutterWidth,
  rowHeight,
  baseCount,
  isMasked,
  isFilteredOut,
  isSelected,
  onRowNumClick,
  onRowContext,
  cellEdit,
}: GridRowProps) {
  const rowTitle = isMasked
    ? "excluded row"
    : isFilteredOut
      ? "dropped by data filter"
      : "click to select · shift-click a range · right-click to mask";

  // `pinnedLeft` is set for the x column only (sticky, alongside the gutter);
  // data columns scroll normally within the windowed slice.
  const cell = (col: number, value: number | undefined, pinnedLeft?: number) => {
    const computed = col >= baseCount; // col -1 (x) and base channels are editable
    const editing = !computed && cellEdit.isEditing(r, col);
    return (
      <div
        key={col}
        role="gridcell"
        className="qzk-grid-cell"
        style={{
          width: colWidth,
          flexShrink: 0,
          color: computed ? "var(--text-dim)" : undefined,
          ...(pinnedLeft != null
            ? { position: "sticky" as const, left: pinnedLeft, zIndex: 2, background: "var(--surface-0)" }
            : {}),
        }}
        onDoubleClick={computed ? undefined : () => cellEdit.startEdit(r, col, value)}
        title={computed ? "computed column — edit the formula" : "double-click to edit"}
      >
        {editing ? (
          <input
            className="qz-input qzk-cell-edit"
            autoFocus
            value={cellEdit.draft}
            onChange={(e) => cellEdit.setDraft(e.target.value)}
            onBlur={cellEdit.commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") cellEdit.commit();
              if (e.key === "Escape") cellEdit.cancel();
            }}
          />
        ) : (
          fmt(value)
        )}
      </div>
    );
  };

  return (
    <div
      role="row"
      className="qzk-grid-row"
      onContextMenu={onRowContext ? (e) => onRowContext(r, e) : undefined}
      style={{
        height: rowHeight,
        ...(isMasked ? { opacity: 0.4, textDecoration: "line-through" } : {}),
        ...(isFilteredOut ? { opacity: 0.5, fontStyle: "italic" } : {}),
        ...(isSelected ? { background: "var(--accent-soft)" } : {}),
      }}
    >
      <div
        role="rowheader"
        className="qzk-grid-cell qzk-grid-rownum"
        style={{
          position: "sticky",
          left: 0,
          zIndex: 2,
          width: gutterWidth,
          flexShrink: 0,
          ...(isSelected ? { color: "var(--accent)", fontWeight: 600 } : {}),
        }}
        title={rowTitle}
        onClick={(e) => onRowNumClick(r, e)}
      >
        {r + 1}
      </div>
      {cell(-1, time[r], gutterWidth)}
      {leadingSpacer > 0 && <div style={{ width: leadingSpacer, flexShrink: 0 }} aria-hidden="true" />}
      {visibleCols.map((c) => cell(c, values[r]?.[c]))}
      {trailingSpacer > 0 && <div style={{ width: trailingSpacer, flexShrink: 0 }} aria-hidden="true" />}
    </div>
  );
}
