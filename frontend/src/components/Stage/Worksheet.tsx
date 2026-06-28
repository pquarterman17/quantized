// Worksheet view of the active dataset: click a header to sort, and add a
// computed column with a formula (e.g. "2*A + sqrt(B)") over x + the channels
// A, B, C … The computed column lands as a derived dataset in the library.

import { useEffect, useMemo, useState } from "react";

import { statsDescriptive } from "../../lib/api";
import { copyText, tableToTSV } from "../../lib/clipboard";
import { fmtNum } from "../../lib/format";
import { channelLetter, compileFormula } from "../../lib/formula";
import type { CalcResult, DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import WorksheetFilterBar from "./WorksheetFilterBar";

const MAX_ROWS = 500;
// The descriptive-stats keys surfaced in the footer (matches StatsCard's set).
const STAT_ROWS: [string, string][] = [
  ["Mean", "mean"],
  ["Std", "std"],
  ["Min", "min"],
  ["Max", "max"],
  ["Median", "median"],
  ["N", "N"],
];
/** Does value `v` pass `op` against `a` (and `b` for "between")? Non-finite fails. */
function passesFilter(v: number | undefined, op: string, a: number, b: number): boolean {
  if (v == null || !Number.isFinite(v)) return false;
  switch (op) {
    case ">": return v > a;
    case ">=": return v >= a;
    case "<": return v < a;
    case "<=": return v <= a;
    case "==": return v === a;
    case "!=": return v !== a;
    case "between": return v >= a && v <= b;
    default: return true;
  }
}

let _seq = 0;

export default function Worksheet() {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const channelRoles = useApp((s) => s.channelRoles); // label/ignore column roles
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [formula, setFormula] = useState("");
  const [colName, setColName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  // Per-column descriptive stats: index 0 = x column, 1.. = channels (null = pending).
  const [colStats, setColStats] = useState<(CalcResult | null)[] | null>(null);
  const [statsErr, setStatsErr] = useState(false);
  // Non-destructive row filter: column ("" none, "-1" x, "c" channel) op value(s).
  const [filterCol, setFilterCol] = useState("");
  const [filterOp, setFilterOp] = useState(">");
  const [filterV1, setFilterV1] = useState("");
  const [filterV2, setFilterV2] = useState("");
  // Masked original-row indices: kept visible (greyed) but excluded from analysis.
  const [masked, setMasked] = useState<Set<number>>(new Set());

  // Row indices keyed by the source dataset; switching/replacing it invalidates them.
  useEffect(() => {
    setMasked(new Set());
  }, [active]);

  // Row indices kept by the filter, in original order (all rows if no/incomplete
  // filter). The view, the stats subset, and "Extract" all derive from this.
  const filtered = useMemo(() => {
    const n = active?.data.time.length ?? 0;
    const all = Array.from({ length: n }, (_, i) => i);
    if (!active || filterCol === "") return all;
    const col = Number(filterCol);
    // Empty string -> NaN (Number("") is 0, which would wrongly filter on "> 0").
    const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
    const a = num(filterV1);
    const b = num(filterV2);
    if (Number.isNaN(a) || (filterOp === "between" && Number.isNaN(b))) return all;
    const { time, values } = active.data;
    const valOf = (r: number) => (col < 0 ? time[r] : values[r]?.[col]);
    return all.filter((r) => passesFilter(valOf(r), filterOp, a, b));
  }, [active, filterCol, filterOp, filterV1, filterV2]);

  // Sort the filtered rows for display (col = -1 is the x column). Non-finite last.
  const order = useMemo(() => {
    if (!active || !sort) return filtered;
    const key = (r: number) =>
      sort.col < 0 ? active.data.time[r] : active.data.values[r]?.[sort.col];
    return [...filtered].sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      if (!Number.isFinite(va)) return 1;
      if (!Number.isFinite(vb)) return -1;
      return (va - vb) * sort.dir;
    });
  }, [active, filtered, sort]);

  // The analysis set = filtered rows minus masked rows. Stats + Extract use this;
  // the displayed table still shows masked rows (greyed) for context.
  const analysisRows = useMemo(
    () => filtered.filter((r) => !masked.has(r)),
    [filtered, masked],
  );

  // Fetch per-column descriptive stats (golden /api/stats/descriptive) over the
  // ANALYSIS rows — independent of the MAX_ROWS display cap and the sort order, so
  // stats follow filter + mask but not pagination/ordering.
  useEffect(() => {
    if (!showStats || !active) {
      setColStats(null);
      setStatsErr(false);
      return;
    }
    let cancelled = false;
    setColStats(null);
    setStatsErr(false);
    const { time, values, labels } = active.data;
    const columns = [
      analysisRows.map((r) => time[r]),
      ...labels.map((_, c) => analysisRows.map((r) => values[r]?.[c])),
    ];
    Promise.all(columns.map((col) => statsDescriptive(col)))
      .then((res) => {
        if (!cancelled) setColStats(res);
      })
      .catch(() => {
        if (!cancelled) setStatsErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, showStats, analysisRows]);

  if (!active) {
    return (
      <div className="qzk-sheet qzk-ds-meta" style={{ padding: 12 }}>
        Select a dataset
      </div>
    );
  }

  const { time, values, labels, units, metadata } = active.data;
  const xName = String(metadata?.["x_column_name"] ?? "x");
  const xUnit = String(metadata?.["x_column_unit"] ?? "");
  const filterActive = filtered.length !== time.length;
  // Extract is meaningful whenever the analysis set differs from the full data
  // (a filter narrowed it and/or some rows are masked), and isn't empty.
  const canExtract = analysisRows.length > 0 && analysisRows.length !== time.length;

  const toggleMask = (r: number) =>
    setMasked((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  const unmaskAll = () => setMasked(new Set());

  // Materialize the analysis set (filtered minus masked) as a new dataset in the
  // library (plottable, fittable) — the non-destructive filter/mask made actionable.
  function extractSubset() {
    if (!canExtract) return;
    const data: DataStruct = {
      time: analysisRows.map((r) => time[r]),
      values: analysisRows.map((r) => values[r]),
      labels,
      units,
      metadata,
    };
    const stem = active!.name.replace(/\.[^.]+$/, "");
    addDataset({ id: `subset-${++_seq}`, name: `${stem} (subset)`, data });
    setStatus(`extracted ${analysisRows.length} of ${time.length} rows`);
  }

  // Copy the visible rows (filtered + sorted, masked excluded) as TSV — the full
  // table (every channel) at full precision, straight to the clipboard. Distinct
  // from the plot's copy-data (which is the plotted series only).
  function copyRows() {
    const rows = order.filter((r) => !masked.has(r));
    const headers = [
      xUnit ? `${xName} (${xUnit})` : xName,
      ...labels.map((lab, c) => (units[c] ? `${lab} (${units[c]})` : lab)),
    ];
    const data = rows.map((r) => [time[r], ...labels.map((_, c) => values[r]?.[c])]);
    copyText(tableToTSV(headers, data)).then((ok) =>
      setStatus(ok ? `copied ${rows.length} rows to clipboard` : "clipboard unavailable"),
    );
  }

  const toggleSort = (col: number) =>
    setSort((s) => (s && s.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));
  const mark = (col: number) => (sort?.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  function addColumn() {
    setErr(null);
    try {
      const fn = compileFormula(formula);
      const computed = time.map((t, r) => {
        const ctx: Record<string, number> = { x: t };
        labels.forEach((_, c) => {
          ctx[channelLetter(c)] = values[r]?.[c];
        });
        return fn(ctx);
      });
      const name = colName.trim() || formula.trim();
      const data: DataStruct = {
        time,
        values: values.map((row, r) => [...row, computed[r]]),
        labels: [...labels, name],
        units: [...units, ""],
        metadata,
      };
      const stem = active!.name.replace(/\.[^.]+$/, "");
      addDataset({ id: `calc-${++_seq}`, name: `${stem} (+${name})`, data });
      setStatus(`added column "${name}"`);
      setFormula("");
      setColName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "formula error");
    }
  }

  const vars = ["x", ...labels.map((_, c) => channelLetter(c))].join(" · ");

  return (
    <div className="qzk-sheet">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderBottom: "1px solid var(--border, #333)",
          flexWrap: "wrap",
        }}
      >
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          ƒx
        </span>
        <input
          className="qz-input"
          placeholder="2*A + sqrt(B)"
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && formula.trim() && addColumn()}
          style={{ width: 200 }}
        />
        <input
          className="qz-input"
          placeholder="column name"
          value={colName}
          onChange={(e) => setColName(e.target.value)}
          style={{ width: 120 }}
        />
        <button className="qz-btn" disabled={!formula.trim()} onClick={addColumn}>
          Add column
        </button>
        <button
          className={showStats ? "qz-btn qz-active" : "qz-btn"}
          aria-pressed={showStats}
          onClick={() => setShowStats((v) => !v)}
          title="Per-column statistics"
        >
          Σ Stats
        </button>
        <button className="qz-btn" onClick={copyRows} title="Copy visible rows to clipboard (TSV)">
          ⧉ Copy
        </button>
        {masked.size > 0 && (
          <button className="qz-btn" onClick={unmaskAll} title="Clear all masked rows">
            Unmask ({masked.size})
          </button>
        )}
        <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          vars: {vars}
        </span>
      </div>

      <WorksheetFilterBar
        xName={xName}
        labels={labels}
        filterCol={filterCol}
        filterOp={filterOp}
        filterV1={filterV1}
        filterV2={filterV2}
        setFilterCol={setFilterCol}
        setFilterOp={setFilterOp}
        setFilterV1={setFilterV1}
        setFilterV2={setFilterV2}
        filterActive={filterActive}
        keptCount={filtered.length}
        totalCount={time.length}
        maskedCount={masked.size}
        canExtract={canExtract}
        onExtract={extractSubset}
      />
      {err && (
        <div className="qzk-ds-meta" style={{ padding: "4px 8px", color: "var(--danger)" }}>
          {err}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th className="rownum">#</th>
            <th onClick={() => toggleSort(-1)} style={{ cursor: "default" }}>
              {xName}
              <span className="role">
                X{xUnit ? ` · ${xUnit}` : ""}
                {mark(-1)}
              </span>
            </th>
            {labels.map((lab, c) => (
              <th
                key={lab}
                onClick={() => toggleSort(c)}
                title={channelRoles[c] ? `${channelLetter(c)} — ${channelRoles[c]} column` : channelLetter(c)}
                style={{ cursor: "default", opacity: channelRoles[c] ? 0.55 : 1 }}
              >
                {lab}
                <span className="role">
                  {channelRoles[c] ?? channelLetter(c)}
                  {units[c] ? ` · ${units[c]}` : ""}
                  {mark(c)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.slice(0, MAX_ROWS).map((r) => {
            const isMasked = masked.has(r);
            return (
              <tr key={r} style={isMasked ? { opacity: 0.4, textDecoration: "line-through" } : undefined}>
                <td
                  className="rownum"
                  style={{ cursor: "pointer" }}
                  title={isMasked ? "click to unmask row" : "click to mask row (exclude from stats)"}
                  onClick={() => toggleMask(r)}
                >
                  {r + 1}
                </td>
                <td>{fmt(time[r])}</td>
                {labels.map((lab, c) => (
                  <td key={lab}>{fmt(values[r]?.[c])}</td>
                ))}
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
      {filtered.length > MAX_ROWS && (
        <div className="qzk-ds-meta" style={{ padding: 8 }}>
          showing {MAX_ROWS} of {filtered.length}
          {filterActive ? ` filtered (${time.length} total)` : ""} rows
        </div>
      )}
    </div>
  );
}

function fmt(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(4);
}
