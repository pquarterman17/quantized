// Peaks workshop — a selectable table for the detected/fitted peak lists
// (UX-R6 follow-up). Same `qz-table` look as primitives/DataTable, but a row
// click/keyboard gesture reports a selection (peakSelection.ts's
// click/ctrl/shift-click contract) instead of just rendering static cells —
// DataTable itself (primitives/, outside this lane) is left untouched.
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import type { SelectMods } from "./peakSelection";

interface Props {
  /** Accessible table name (`aria-label`) — how tests/AT distinguish the
   *  detected-peaks table from the fitted-peaks one. */
  ariaLabel: string;
  columns: ReactNode[];
  rows: ReactNode[][];
  selected: ReadonlySet<number>;
  onSelect: (index: number, mods: SelectMods) => void;
}

function modsFrom(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): SelectMods {
  return { shift: e.shiftKey, ctrlOrMeta: e.ctrlKey || e.metaKey };
}

export default function PeakTable({ ariaLabel, columns, rows, selected, onSelect }: Props) {
  const onRowKeyDown = (index: number) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(index, modsFrom(e));
      return;
    }
    // Arrow-key row-to-row focus movement (keyboard reachability) — moves
    // FOCUS only, matching LibraryDetails.tsx's roving convention that
    // navigation and selection are separate gestures; Enter/Space (above)
    // or a click still does the actual selecting.
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const target = e.currentTarget.parentElement?.children[index + dir] as HTMLElement | undefined;
    target?.focus();
  };

  const onRowClick = (index: number) => (e: MouseEvent<HTMLTableRowElement>) => onSelect(index, modsFrom(e));

  return (
    <table className="qz-table" aria-label={ariaLabel}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const isSelected = selected.has(i);
          return (
            <tr
              key={i}
              aria-selected={isSelected}
              tabIndex={0}
              // Design tokens only (CLAUDE.md) — same visual contract as
              // LibraryDetails' `.qzk-details-table tbody tr.selected`
              // (shell.css), applied inline here since that stylesheet is
              // outside this lane's file ownership.
              style={
                isSelected
                  ? { background: "var(--accent-soft)", boxShadow: "inset 2px 0 var(--accent)" }
                  : undefined
              }
              onClick={onRowClick(i)}
              onKeyDown={onRowKeyDown(i)}
            >
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
