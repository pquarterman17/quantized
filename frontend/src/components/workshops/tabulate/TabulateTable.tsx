// Tabulate workshop — live preview table (JMP_GAP_PLAN J6). Renders the
// nested group columns (their resolved text labels, never ordinal codes —
// levelLabel) followed by one column per (value column x checked stat),
// grouped under a spanning value-column header. Pure view — all the grouping
// math lives in lib/tabulate, all the state in useTabulate.

import { fmtNum } from "../../../lib/format";
import type { StatKey, TabRow } from "../../../lib/tabulate";

export default function TabulateTable({
  groupLabels,
  valueLabels,
  statKeys,
  rows,
  levelLabel,
}: {
  groupLabels: readonly string[];
  valueLabels: readonly string[];
  statKeys: readonly StatKey[];
  rows: readonly TabRow[];
  levelLabel: (row: TabRow, depth: number) => string;
}) {
  if (!statKeys.length) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
        Pick at least one stat to display.
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
        No finite rows to summarize.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", marginTop: 12 }}>
      <table
        className="qzk-tabulate-table"
        style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}
      >
        <thead style={{ color: "var(--text-faint)" }}>
          <tr>
            {groupLabels.map((label, d) => (
              <th key={`g-${d}`} rowSpan={2} style={{ textAlign: "left", verticalAlign: "bottom" }}>
                {label}
              </th>
            ))}
            {valueLabels.map((label, vi) => (
              <th
                key={`v-${vi}`}
                colSpan={statKeys.length}
                style={{ textAlign: "center", borderBottom: "1px solid var(--border, currentColor)" }}
              >
                {label}
              </th>
            ))}
          </tr>
          <tr>
            {valueLabels.flatMap((_, vi) =>
              statKeys.map((k) => (
                <th key={`s-${vi}-${k}`} style={{ textAlign: "right", fontWeight: 400 }}>
                  {k}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
          {rows.map((r, ri) => (
            <tr key={ri} style={{ textAlign: "right", fontWeight: r.isTotal ? 600 : 400 }}>
              {groupLabels.map((_, d) => (
                <td key={`g-${d}`} style={{ textAlign: "left", color: "var(--text)" }}>
                  {levelLabel(r, d)}
                </td>
              ))}
              {valueLabels.flatMap((_, vi) =>
                statKeys.map((k) => (
                  <td key={`c-${vi}-${k}`}>{fmtNum(r.values[vi][k])}</td>
                )),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
