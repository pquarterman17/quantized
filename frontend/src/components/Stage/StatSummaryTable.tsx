// The Statistics stage's per-group summary table (P2.6 box 4, "summary table
// links to selected groups"): one row per category slot the plot shows —
// empty levels included, as n=0 rows — with n, the value column's mean / SD /
// median / min / max (one mean per channel for a multi-channel bar), the rows
// dropped at that level, and how many of its rows are in the app's row
// selection. Picking a row selects that group's rows (see
// `statGroupSummary`'s header for the exact contract); the selection made
// anywhere else shows up here.
//
// Keyboard (the PeakTable conventions — a grid with ONE roving tab stop):
// ArrowUp/ArrowDown/Home/End move focus; Enter/Space pick the focused group
// (Ctrl/Cmd toggles it, Shift extends a range); Shift+Arrow extends the
// range as it moves; Escape clears the selection. Delete/Backspace are
// CONSUMED: a focused row is not a text field, so without that the global
// shortcut would delete the selected dataset (PeakTable's own finding).

import { useState, type KeyboardEvent, type MouseEvent } from "react";

import { fmtNum } from "../../lib/format";
import type { SummaryRow, SummaryStats } from "./statGroupSummary";
import type { StatGroupSelection } from "./useStatGroupSelection";

const STAT_KEYS: (keyof SummaryStats)[] = ["mean", "sd", "median", "min", "max"];
const STAT_HEAD: Record<keyof SummaryStats, string> = { mean: "mean", sd: "SD", median: "median", min: "min", max: "max" };

interface Props {
  sel: StatGroupSelection;
  valueLabels: readonly string[];
}

const modsOf = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => ({
  toggle: e.ctrlKey || e.metaKey,
  range: e.shiftKey,
});

function statCells(row: SummaryRow, multi: boolean): string[] {
  if (multi) return row.stats.map((s) => fmtNum(s.mean));
  const s = row.stats[0];
  return STAT_KEYS.map((k) => (s ? fmtNum(s[k]) : "—"));
}

export default function StatSummaryTable({ sel, valueLabels }: Props) {
  const rows = sel.visible;
  const multi = valueLabels.length > 1;
  const [roving, setRoving] = useState(0);
  const focusIndex = rows.length === 0 ? 0 : Math.min(roving, rows.length - 1);
  const heads = multi ? valueLabels.map((l) => `mean ${l}`) : STAT_KEYS.map((k) => STAT_HEAD[k]);

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    const row = rows[i];
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      sel.select(row.key, modsOf(e));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      sel.clear();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return;
    }
    const to =
      e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = Math.min(rows.length - 1, Math.max(0, to));
    if (next === i) return;
    if (e.shiftKey) sel.select(rows[next].key, { toggle: false, range: true }, undefined, row.key);
    setRoving(next);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  const onClick = (i: number) => (e: MouseEvent<HTMLTableRowElement>) => {
    setRoving(i);
    sel.select(rows[i].key, modsOf(e));
  };

  return (
    <table className="qz-table" role="grid" aria-label="Group summary" aria-multiselectable="true">
      <thead>
        <tr>
          <th>level</th>
          <th>n</th>
          {heads.map((h) => (
            <th key={h}>{h}</th>
          ))}
          <th title="rows at this level left out: non-finite value, excluded or filtered">dropped</th>
          <th title="rows of this group in the current row selection">sel</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const selected = sel.isSelected(row);
          const k = sel.counts[i] ?? 0;
          const partial = !selected && k > 0;
          const dropped = row.nonFinite + row.excluded;
          return (
            <tr
              key={row.key}
              data-key={row.key}
              aria-selected={selected}
              tabIndex={i === focusIndex ? 0 : -1}
              onFocus={() => setRoving(i)}
              onClick={onClick(i)}
              onKeyDown={onKeyDown(i)}
              style={
                selected
                  ? { background: "var(--accent-soft)", boxShadow: "inset 2px 0 var(--accent)" }
                  : partial
                    ? { boxShadow: "inset 2px 0 var(--accent)" }
                    : undefined
              }
            >
              <td role="gridcell" title={row.absent ? `${row.label} (never occurs)` : row.label} style={row.n === 0 ? { fontStyle: "italic" } : undefined}>
                {row.label}
              </td>
              <td role="gridcell">{row.n}</td>
              {statCells(row, multi).map((c, j) => (
                <td role="gridcell" key={j}>{c}</td>
              ))}
              <td role="gridcell" title={dropped ? `${row.nonFinite} non-finite, ${row.excluded} excluded/filtered` : undefined}>{dropped || ""}</td>
              <td role="gridcell">{k > 0 ? (k === row.n ? "all" : `${k}/${row.n}`) : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
