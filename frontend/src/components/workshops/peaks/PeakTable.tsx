// Peaks workshop — a selectable table for the detected/fitted peak lists
// (UX-R6 follow-up). Same `qz-table` look as primitives/DataTable, but a row
// click/keyboard gesture reports a selection (peakSelection.ts's
// click/ctrl/shift-click contract) instead of just rendering static cells —
// DataTable itself (primitives/, outside this lane) is left untouched.
//
// `onSelect` OMITTED (K1 review finding) means this table is currently the
// NON-governing one (PeaksPanel.tsx: only one of detected/fitted ever backs
// "Label peaks" at a time) — it renders fully inert, matching the read-only
// DataTable it replaced: no `aria-selected`, no highlight, no tab stop, no
// click/keyboard handler at all. A row must never look selected while the
// action that would use it ignores it.
//
// Roving tabindex (K2 review finding): exactly ONE row is a Tab stop at a
// time — the LibraryDetails.tsx convention (`tabIndex={key === rovingKey ?
// 0 : -1}`) — not "every row", which turned a 20-40-peak table into that
// many Tab stops before reaching the Fit/Label buttons. Arrow keys move the
// roving stop (focus only); Shift+Arrow also extends the range selection,
// falling out of the same key handler for free.
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import type { SelectMods } from "./peakSelection";

interface Props {
  /** Accessible table name (`aria-label`) — how tests/AT distinguish the
   *  detected-peaks table from the fitted-peaks one. */
  ariaLabel: string;
  columns: ReactNode[];
  rows: ReactNode[][];
  selected: ReadonlySet<number>;
  /** Omit to render this table inert (non-governing) — see module header. */
  onSelect?: (index: number, mods: SelectMods) => void;
}

function modsFrom(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): SelectMods {
  return { shift: e.shiftKey, ctrlOrMeta: e.ctrlKey || e.metaKey };
}

export default function PeakTable({ ariaLabel, columns, rows, selected, onSelect }: Props) {
  const interactive = onSelect != null;
  const [rovingIndex, setRovingIndex] = useState(0);
  // Clamp rather than store the clamped value — `rows.length` can shrink
  // (fewer peaks after a re-detect) without this table unmounting.
  const focusIndex = rows.length === 0 ? 0 : Math.min(rovingIndex, rows.length - 1);

  const onRowKeyDown = (index: number) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(index, modsFrom(e));
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const next = Math.min(rows.length - 1, Math.max(0, index + dir));
    if (next === index) return;
    // Shift+Arrow extends the range selection to the new row (mirrors
    // shift-click) — falls out of the same navigation step, not a separate
    // gesture: navigation and selection stay independent otherwise (a bare
    // arrow moves focus only, matching LibraryDetails.tsx's convention).
    if (e.shiftKey) onSelect?.(next, { shift: true, ctrlOrMeta: false });
    setRovingIndex(next);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  const onRowClick = (index: number) => (e: MouseEvent<HTMLTableRowElement>) => onSelect?.(index, modsFrom(e));

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
          const isSelected = interactive && selected.has(i);
          return (
            <tr
              key={i}
              aria-selected={interactive ? isSelected : undefined}
              tabIndex={interactive ? (i === focusIndex ? 0 : -1) : -1}
              onFocus={interactive ? () => setRovingIndex(i) : undefined}
              // Design tokens only (CLAUDE.md) — same visual contract as
              // LibraryDetails' `.qzk-details-table tbody tr.selected`
              // (shell.css), applied inline here since that stylesheet is
              // outside this lane's file ownership.
              style={
                isSelected
                  ? { background: "var(--accent-soft)", boxShadow: "inset 2px 0 var(--accent)" }
                  : undefined
              }
              onClick={interactive ? onRowClick(i) : undefined}
              onKeyDown={interactive ? onRowKeyDown(i) : undefined}
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
