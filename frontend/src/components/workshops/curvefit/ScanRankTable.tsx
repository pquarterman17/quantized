// Rank all models: the result table. One row per model (a failed one shows its
// reason in place of numbers), sortable by clicking a column, the best
// converged model marked, and one row selected for "Use this model".

import { useState } from "react";

import type { ScanEntry } from "../../../lib/api/curvefit";
import { fmtNum as fmt } from "../../../lib/format";
import { bestEntry, entryKey, FIRST_DIR, sortScan, type ScanSort, type ScanSortKey } from "./scanRank";

const COLS: { key: ScanSortKey; head: string; title: string }[] = [
  { key: "k", head: "k", title: "free parameters" },
  { key: "chiSqRed", head: "χ²red", title: "reduced chi-square" },
  { key: "adjR2", head: "R²adj", title: "adjusted R²" },
  { key: "AIC", head: "AIC", title: "Akaike information criterion" },
  { key: "AICc", head: "AICc", title: "AIC with the small-sample correction (the ranking key)" },
  { key: "BIC", head: "BIC", title: "Bayesian information criterion" },
  { key: "weight", head: "w", title: "Akaike weight: exp(−Δ/2) over the sum of the same over the converged models (they add to 1; an unconverged fit has none)" },
];

interface Props {
  results: readonly ScanEntry[];
  /** The key (`kind:name`) of the selected row, or null for the best one. */
  selected: string | null;
  onSelect: (key: string) => void;
  stale: boolean;
}

export default function ScanRankTable({ results, selected, onSelect, stale }: Props) {
  const [sort, setSort] = useState<ScanSort | null>(null);
  const best = bestEntry(results);
  const bestKey = best ? entryKey(best) : null;
  const click = (key: ScanSortKey) =>
    setSort((s) =>
      s?.key !== key
        ? { key, dir: FIRST_DIR[key] }
        : s.dir === FIRST_DIR[key]
          ? { key, dir: FIRST_DIR[key] === "asc" ? "desc" : "asc" }
          : null,
    );
  const ariaSort = (key: ScanSortKey) =>
    sort?.key !== key ? "none" : sort.dir === "asc" ? "ascending" : "descending";

  return (
    <table className="qz-table" aria-label="Model ranking">
      <thead>
        <tr>
          <th>model</th>
          {COLS.map((c) => (
            <th key={c.key} aria-sort={ariaSort(c.key)} title={c.title}>
              <button
                type="button"
                onClick={() => click(c.key)}
                style={{ all: "inherit", padding: 0, position: "static" }}
              >
                {c.head}
              </button>
            </th>
          ))}
          <th title="did the optimiser report convergence">conv.</th>
          <th title="AICc minus the best converged AICc">ΔAICc</th>
        </tr>
      </thead>
      <tbody>
        {sortScan(results, sort).map((e) => {
          const key = entryKey(e);
          const isSel = key === (selected ?? bestKey);
          return (
            <tr
              key={key}
              aria-selected={isSel}
              title={e.error ?? (stale ? "Out of date: rank again" : undefined)}
              style={{ opacity: e.error ? 0.6 : 1, background: isSel ? "var(--surface-3)" : undefined }}
              onClick={() => {
                if (!e.error) onSelect(key);
              }}
            >
              <td>
                {!e.error && (
                  <input
                    type="radio"
                    name="rank-model"
                    aria-label={`Select ${e.name}`}
                    checked={isSel}
                    onChange={() => onSelect(key)}
                    style={{ marginRight: 4 }}
                  />
                )}
                {e.kind === "equation" ? `ƒ ${e.name}` : e.name}
                {key === bestKey && <strong style={{ marginLeft: 6, color: "var(--accent)" }}>best</strong>}
              </td>
              {e.error ? (
                <td colSpan={9} style={{ color: "var(--danger)", textAlign: "left" }}>
                  {e.error}
                </td>
              ) : (
                <>
                  <td>{e.k}</td>
                  <td>{fmt(e.chiSqRed)}</td>
                  <td>{fmt(e.adjR2)}</td>
                  <td>{fmt(e.AIC)}</td>
                  <td>{fmt(e.AICc)}</td>
                  <td>{fmt(e.BIC)}</td>
                  <td>{fmt(e.weight)}</td>
                  <td>{e.converged ? "yes" : "no"}</td>
                  <td>{fmt(e.deltaAICc)}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
