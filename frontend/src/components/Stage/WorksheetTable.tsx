// The Worksheet's data grid: a sortable header, editable cells (double-click to
// edit, Enter/blur commits, Esc cancels), a clickable row-number gutter to mask
// rows, and an optional per-column statistics footer. Presentational + local
// edit state only; row/column edits are reported up via onEditCell. Extracted
// from Worksheet to keep that container under the size budget.

import { useState } from "react";

import { channelLetter } from "../../lib/formula";
import { fmtNum } from "../../lib/format";
import type { CalcResult, ChannelRole } from "../../lib/types";

// The descriptive-stats keys surfaced in the footer (matches StatsCard's set).
const STAT_ROWS: [string, string][] = [
  ["Mean", "mean"],
  ["Std", "std"],
  ["Min", "min"],
  ["Max", "max"],
  ["Median", "median"],
  ["N", "N"],
];

export interface WorksheetTableProps {
  time: number[];
  values: number[][];
  labels: string[];
  units: string[];
  xName: string;
  xUnit: string;
  order: number[];
  masked: Set<number>;
  channelRoles: Record<number, ChannelRole>;
  sortMark: (col: number) => string;
  onToggleSort: (col: number) => void;
  onToggleMask: (r: number) => void;
  onEditCell: (row: number, col: number, value: number) => void;
  /** Channels at index ≥ baseCount are computed (formula) columns: read-only +
   *  removable, marked "ƒx" in the header. */
  baseCount: number;
  onRemoveFormula: (index: number) => void;
  maxRows: number;
  showStats: boolean;
  colStats: (CalcResult | null)[] | null;
  statsErr: boolean;
}

export default function WorksheetTable({
  time,
  values,
  labels,
  units,
  xName,
  xUnit,
  order,
  masked,
  channelRoles,
  sortMark,
  onToggleSort,
  onToggleMask,
  onEditCell,
  baseCount,
  onRemoveFormula,
  maxRows,
  showStats,
  colStats,
  statsErr,
}: WorksheetTableProps) {
  // The cell currently being edited (col -1 = x column) and its in-progress text.
  const [edit, setEdit] = useState<{ row: number; col: number } | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (row: number, col: number, current: number | undefined): void => {
    setEdit({ row, col });
    setDraft(current != null && Number.isFinite(current) ? String(current) : "");
  };
  const commit = (): void => {
    if (!edit) return;
    // Blank → NaN (a deliberate "missing" marker); otherwise parse the number.
    const v = draft.trim() === "" ? Number.NaN : Number(draft);
    onEditCell(edit.row, edit.col, v);
    setEdit(null);
  };

  const cell = (r: number, col: number, value: number | undefined) => {
    const computed = col >= baseCount; // col -1 (x) and base channels are editable
    const editing = !computed && edit != null && edit.row === r && edit.col === col;
    return (
      <td
        key={col}
        onDoubleClick={computed ? undefined : () => startEdit(r, col, value)}
        title={computed ? "computed column — edit the formula" : "double-click to edit"}
        style={computed ? { color: "var(--text-dim)" } : undefined}
      >
        {editing ? (
          <input
            className="qz-input qzk-cell-edit"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEdit(null);
            }}
          />
        ) : (
          fmt(value)
        )}
      </td>
    );
  };

  return (
    <table>
      <thead>
        <tr>
          <th className="rownum">#</th>
          <th onClick={() => onToggleSort(-1)} style={{ cursor: "default" }}>
            {xName}
            <span className="role">
              X{xUnit ? ` · ${xUnit}` : ""}
              {sortMark(-1)}
            </span>
          </th>
          {labels.map((lab, c) => {
            const computed = c >= baseCount;
            return (
              <th
                key={lab}
                onClick={() => onToggleSort(c)}
                title={
                  computed
                    ? `${channelLetter(c)} — computed column`
                    : channelRoles[c]
                      ? `${channelLetter(c)} — ${channelRoles[c]} column`
                      : channelLetter(c)
                }
                style={{ cursor: "default", opacity: channelRoles[c] ? 0.55 : 1 }}
              >
                {lab}
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
                  {units[c] ? ` · ${units[c]}` : ""}
                  {sortMark(c)}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {order.slice(0, maxRows).map((r) => {
          const isMasked = masked.has(r);
          return (
            <tr key={r} style={isMasked ? { opacity: 0.4, textDecoration: "line-through" } : undefined}>
              <td
                className="rownum"
                style={{ cursor: "pointer" }}
                title={isMasked ? "click to unmask row" : "click to mask row (exclude from stats)"}
                onClick={() => onToggleMask(r)}
              >
                {r + 1}
              </td>
              {cell(r, -1, time[r])}
              {labels.map((_, c) => cell(r, c, values[r]?.[c]))}
            </tr>
          );
        })}
      </tbody>
      {showStats && (
        <tfoot>
          {statsErr ? (
            <tr>
              <td className="rownum" />
              <td colSpan={labels.length + 1} className="qzk-ds-meta">
                statistics unavailable offline
              </td>
            </tr>
          ) : (
            STAT_ROWS.map(([label, key]) => (
              <tr key={key}>
                <td className="rownum" title="column statistic">
                  {label}
                </td>
                <td>{colStats ? fmtNum(colStats[0]?.[key]) : "…"}</td>
                {labels.map((lab, c) => (
                  // "ignore" columns are out of analysis → blank their stats.
                  <td key={lab}>
                    {channelRoles[c] === "ignore" ? "—" : colStats ? fmtNum(colStats[c + 1]?.[key]) : "…"}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tfoot>
      )}
    </table>
  );
}

function fmt(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(4);
}
