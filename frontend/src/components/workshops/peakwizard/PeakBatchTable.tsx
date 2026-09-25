// Peak Analyzer batch — the sortable uncertainty / diagnostic table (audit
// P2.4 slice 4). Rows come from ./peakBatchTable (pure): one per (dataset,
// peak), a failed dataset as one row with its reason. Every missing error is
// "± —" whose tooltip says WHY (./modelFitReasons); the objective column
// names what each fit minimised (SSR, or χ² only for a weighted fit); the
// warnings cell shows the count, the texts on hover and on expand.

import { useMemo, useState, type ReactNode } from "react";

import { fmtNum } from "../../../lib/format";
import { DERIVED, sortRows, type BatchTableRow, type SortKey, type ValueErr } from "./peakBatchTable";

const faint = { color: "var(--text-faint)" } as const;
const mono = { fontFamily: "var(--font-mono)", whiteSpace: "nowrap" } as const;

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: "dataset", label: "Dataset" },
  { key: "peak", label: "#" },
  { key: "shape", label: "Shape" },
  { key: "status", label: "Status" },
  { key: "center", label: "Center" },
  { key: "fwhm", label: "FWHM" },
  { key: "height", label: "Height" },
  { key: "area", label: "Area" },
  { key: "rSquared", label: "R²" },
  { key: "objective", label: "Objective" },
  { key: "reducedObjective", label: "Reduced" },
  { key: "aic", label: "AIC" },
  { key: "bic", label: "BIC" },
  { key: "nPoints", label: "Points" },
  { key: "warnings", label: "Warnings" },
  { key: null, label: "Flags" },
];

function Pm({ c }: { c: ValueErr | null }): ReactNode {
  if (!c) return <span style={faint}>—</span>;
  return (
    <span style={mono}>
      {fmtNum(c.value)}{" "}
      {c.err !== null ? (
        <span style={faint}>± {fmtNum(c.err)}</span>
      ) : (
        <span style={faint} title={c.reason ?? "no error reported"} data-no-error="">
          ± —
        </span>
      )}
    </span>
  );
}

function Objective({ label, value }: { label: string | null; value: number | null }): ReactNode {
  if (label === null) return <span style={faint}>—</span>;
  return (
    <span style={mono} data-objective={label}>
      <span style={faint}>{label}</span> {fmtNum(value)}
    </span>
  );
}

function Warnings({ list }: { list: string[] }): ReactNode {
  if (list.length === 0) return <span style={mono}>0</span>;
  return (
    <details>
      <summary title={list.join("\n")} style={{ ...mono, color: "var(--warn)" }}>
        {list.length}
      </summary>
      <ul role="list" style={{ margin: 0, paddingLeft: 14, fontSize: "var(--font-size-sm)", minWidth: 220 }}>
        {list.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

function Flags({ r }: { r: BatchTableRow }): ReactNode {
  const parts = [
    r.atBound.length ? `at bound: ${r.atBound.join(", ")}` : null,
    r.undetermined.length ? `undetermined: ${r.undetermined.join(", ")}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? <span style={{ color: "var(--warn)" }}>{parts.join("; ")}</span> : <span style={faint}>—</span>;
}

function Status({ r }: { r: BatchTableRow }): ReactNode {
  const tone = r.status === "converged" ? "var(--ok)" : r.error ? "var(--danger)" : "var(--warn)";
  return (
    <span>
      <span style={{ color: tone, whiteSpace: "nowrap" }}>{r.status}</span>
      {r.error && <span style={{ ...faint, display: "block", minWidth: 160 }}>{r.error}</span>}
    </span>
  );
}

export default function PeakBatchTable({ rows }: { rows: BatchTableRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const shown = useMemo(() => (sort ? sortRows(rows, sort.key, sort.dir) : rows), [rows, sort]);
  const onSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div style={{ overflow: "auto", maxHeight: 320, marginTop: 6 }}>
      <table className="qz-table" aria-label="batch results">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.label}
                aria-sort={sort && c.key === sort.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                {c.key ? (
                  <button type="button" className="qz-btn qz-ghost qz-sm" onClick={() => onSort(c.key!)}>
                    {c.label}
                    {sort?.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={`${r.datasetId}:${r.peak ?? "x"}`} data-status={r.status}>
              <td>{r.dataset}</td>
              <td style={mono}>{r.peak ?? "—"}</td>
              <td>{r.shape ?? "—"}</td>
              <td><Status r={r} /></td>
              {DERIVED.map((k) => (
                <td key={k}><Pm c={r[k]} /></td>
              ))}
              <td style={mono}>{fmtNum(r.rSquared)}</td>
              <td><Objective label={r.objectiveLabel} value={r.objective} /></td>
              <td>
                <Objective label={r.objectiveLabel && `red. ${r.objectiveLabel}`} value={r.reducedObjective} />
              </td>
              <td style={mono}>{fmtNum(r.aic)}</td>
              <td style={mono}>{fmtNum(r.bic)}</td>
              <td style={mono}>{r.nPoints ?? "—"}</td>
              <td><Warnings list={r.warnings} /></td>
              <td><Flags r={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
