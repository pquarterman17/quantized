// One worksheet grid data row (WORKSHEET_PLAN item 2): the row-number gutter
// (pinned, click to select / shift-click a range / right-click to mask), the
// pinned x cell, then the windowed slice of value/computed cells, then (item
// 8) any read-only Origin text cells, unvirtualized, appended at the very
// end (same position as the header's text-column run, so columns line up).
// Double-click a cell to edit (Enter/blur commits, Escape cancels via
// `cellEdit`); computed (formula) and text columns are read-only. Mask (#50)
// / global-filter (#53) / row-selection styling is applied from booleans the
// container derives via lib/rowstate ONLY — this component just renders what
// it's handed. Column-selection highlight (item 6) shades the pinned x cell
// and any selected value cell in this row, matching the header's highlight.
//
// P1.6b item 7: a categorical cell (`catLevels(col)` non-null) displays its
// LEVEL LABEL, never the raw numeric code, and edits through a level-picker
// `<select>` instead of the plain numeric `<input>` — see `catCell`'s doc
// below for the pick/extend affordance. `onEditCategoricalCell` is a
// SEPARATE callback from `onCommit` (which is numeric-only, `useCellEdit`'s
// contract) because the store's `setCategoricalCell` takes the typed LABEL
// and decides pick-vs-extend-vs-clear itself (store/cellEdit.ts) — this
// component has no opinion on that, it only collects the text.

import { useState } from "react";

import { labelForCode } from "../../../lib/categorical";
import type { TextColumn } from "../../../lib/columnmeta";
import { fmtCell } from "./cellFormat";
import type { CellEditApi } from "./useCellEdit";

/** Sentinel `<select>` value meaning "the user wants to type a new level"
 *  (never a real level string — level text is unconstrained, but this one
 *  string is reserved by construction: nothing before it can produce a
 *  collision because it's checked as an exact `<option value>`, not parsed
 *  from level text). */
const ADD_NEW = "__new__";

export interface GridRowProps {
  r: number; // original row index
  time: number[];
  values: number[][];
  visibleCols: number[];
  leadingSpacer: number;
  trailingSpacer: number;
  colWidth: number;
  /** Per-column width (MAIN_PLAN #3) — resized columns differ from the
   *  uniform `colWidth`, which text columns keep. -1 = the pinned x column. */
  widthOf: (col: number) => number;
  gutterWidth: number;
  rowHeight: number;
  baseCount: number;
  isMasked: boolean;
  isFilteredOut: boolean;
  isSelected: boolean;
  selectedCols: Set<number>;
  onRowNumClick: (r: number, e: React.MouseEvent) => void;
  onRowContext?: (row: number, e: React.MouseEvent) => void;
  cellEdit: CellEditApi;
  /** Read-only Origin text columns (item 8) — see module doc above. */
  textCols: TextColumn[];
  /** P1.6b: a column's level table, or `null` when it isn't categorical.
   *  Optional so every existing caller/test (plain numeric grids) is
   *  unaffected — omitting it renders every column the old numeric way. */
  catLevels?: (col: number) => string[] | null;
  /** P1.6b: commit a categorical cell's typed/picked LABEL — see module doc. */
  onEditCategoricalCell?: (row: number, col: number, label: string) => void;
}

export default function GridRow({
  r,
  time,
  values,
  visibleCols,
  leadingSpacer,
  trailingSpacer,
  colWidth,
  widthOf,
  gutterWidth,
  rowHeight,
  baseCount,
  isMasked,
  isFilteredOut,
  isSelected,
  selectedCols,
  onRowNumClick,
  onRowContext,
  cellEdit,
  textCols,
  catLevels,
  onEditCategoricalCell,
}: GridRowProps) {
  const rowTitle = isMasked
    ? "excluded row"
    : isFilteredOut
      ? "dropped by data filter"
      : "click to select · shift-click a range · right-click to mask";

  // Only ONE cell in the whole grid ever edits at a time (`cellEdit.target`
  // is grid-global — GridViewport owns one `useCellEdit`), so this row-local
  // "typing a new level" toggle is safe: only the row that actually has an
  // editing categorical cell will ever set it, every other row's copy stays
  // false and unused.
  const [addingNew, setAddingNew] = useState(false);

  /** P1.6b's categorical cell editor: pick an existing level (commits
   *  immediately, matching a plain select's usual feel) or "+ Add new
   *  level…" to switch into a text box (Enter commits the typed text,
   *  Escape backs out to the picker without losing the edit entirely). The
   *  STORE decides pick-vs-extend-vs-clear (`setCategoricalCell`) — this
   *  only collects a label string. */
  const catCell = (col: number, levels: string[], code: number) => {
    const current = labelForCode(levels, code) ?? "";
    const commit = (label: string) => {
      onEditCategoricalCell?.(r, col, label);
      setAddingNew(false);
      cellEdit.cancel();
    };
    if (addingNew) {
      return (
        <input
          className="qz-input qzk-cell-edit"
          autoFocus
          value={cellEdit.draft}
          onChange={(e) => cellEdit.setDraft(e.target.value)}
          onBlur={() => commit(cellEdit.draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(cellEdit.draft);
            if (e.key === "Escape") setAddingNew(false); // back to the picker, still editing
          }}
        />
      );
    }
    return (
      <select
        className="qz-select qzk-cell-edit"
        autoFocus
        value={current}
        onChange={(e) => {
          if (e.target.value === ADD_NEW) {
            cellEdit.setDraft("");
            setAddingNew(true);
          } else {
            commit(e.target.value);
          }
        }}
        onKeyDown={(e) => e.key === "Escape" && cellEdit.cancel()}
      >
        <option value="">— missing —</option>
        {levels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
        <option value={ADD_NEW}>+ Add new level…</option>
      </select>
    );
  };

  // `pinnedLeft` is set for the x column only (sticky, alongside the gutter);
  // data columns scroll normally within the windowed slice. A column-selected
  // cell (item 6) gets the same accent-soft shading as the header does, so
  // the highlight reads as one continuous column down the grid.
  const cell = (col: number, value: number | undefined, pinnedLeft?: number) => {
    const computed = col >= baseCount; // col -1 (x) and base channels are editable
    const editing = !computed && cellEdit.isEditing(r, col);
    const colSelected = selectedCols.has(col);
    const levels = computed ? null : (catLevels?.(col) ?? null);
    return (
      <div
        key={col}
        role="gridcell"
        className="qzk-grid-cell"
        style={{
          width: widthOf(col),
          flexShrink: 0,
          color: computed ? "var(--text-dim)" : undefined,
          ...(colSelected ? { background: "var(--accent-soft)" } : {}),
          ...(pinnedLeft != null
            ? { position: "sticky" as const, left: pinnedLeft, zIndex: 2, background: colSelected ? "var(--accent-soft)" : "var(--surface-0)" }
            : {}),
        }}
        onDoubleClick={
          computed
            ? undefined
            : () => {
                setAddingNew(false); // a fresh double-click always opens the picker, not a stale text box
                cellEdit.startEdit(r, col, value);
              }
        }
        title={computed ? "computed column — edit the formula" : "double-click to edit"}
      >
        {editing && levels ? (
          catCell(col, levels, value ?? Number.NaN)
        ) : editing ? (
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
        ) : levels ? (
          labelForCode(levels, value ?? Number.NaN) ?? "—"
        ) : (
          fmtCell(value)
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
      {textCols.map((t) => (
        <div
          key={`text-${t.shortName}`}
          role="gridcell"
          className="qzk-grid-cell"
          style={{ width: colWidth, flexShrink: 0, textAlign: "left", color: "var(--text-dim)" }}
          title="read-only text column"
        >
          {t.rows[r] ?? ""}
        </div>
      ))}
    </div>
  );
}
