// Statistical tests workshop — the response-screening pictures (GAP_AUDIT_9
// G26): the adjusted-LogWorth bar chart (JMP style: one bar per Y × X pair,
// longest first, a reference line at -log10(alpha)) and the p-value plot
// (-log10 p against rank, with the Benjamini-Hochberg line alpha·i/m when the
// adjustment is BH). Modest SVG like SpcView; Graph Builder stays the
// publication-plot path. Also SortableTable, the sortable result table.

import { useMemo, useState } from "react";

import type { ResponseScreeningResult } from "../../../lib/api/statsTestsScreen";
import { fmtNum } from "../../../lib/format";
import type { ResultTable } from "../../../lib/statsTestsResults";

const W = 460;
const PAD = { l: 8, r: 36, t: 10, b: 28 };
const MAX_BARS = 25;
const BAR_H = 14;

const tick = (v: number): string => String(Number(v.toPrecision(3)));

function BarChart({ r }: { r: ResponseScreeningResult }) {
  const rows = r.results.filter((x) => x.adj_logworth != null)
    .sort((a, b) => (b.adj_logworth as number) - (a.adj_logworth as number)).slice(0, MAX_BARS);
  if (rows.length === 0) return null;
  const ref = -Math.log10(r.alpha);
  const top = Math.max(ref, ...rows.map((x) => x.adj_logworth as number)) * 1.08 || 1;
  const labelW = 150;
  const H = PAD.t + rows.length * BAR_H + PAD.b;
  const sx = (v: number) => PAD.l + labelW + (v / top) * (W - PAD.l - PAD.r - labelW);
  return (
    <figure style={{ margin: "0 0 8px" }}>
      <figcaption className="qzk-field-lbl">
        Adjusted LogWorth (-log10 adjusted p){r.results.filter((x) => x.adj_logworth != null).length > MAX_BARS ? ` · top ${MAX_BARS}` : ""} · dashed: alpha
      </figcaption>
      <svg role="img" aria-label="Adjusted LogWorth bar chart" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
        {rows.map((x, i) => {
          const y = PAD.t + i * BAR_H;
          const label = `${x.y} × ${x.x}`;
          return (
            <g key={`${x.y}|${x.x}`} data-bar>
              <text x={PAD.l + labelW - 4} y={y + BAR_H / 2 + 3} textAnchor="end" fontSize={9} fill="var(--text-dim)">
                {label.length > 26 ? `${label.slice(0, 25)}…` : label}<title>{label}</title>
              </text>
              <rect x={sx(0)} y={y + 2} width={Math.max(1, sx(x.adj_logworth as number) - sx(0))} height={BAR_H - 4}
                fill={x.significant ? "var(--accent)" : "var(--border-strong)"} />
              <text x={sx(x.adj_logworth as number) + 3} y={y + BAR_H / 2 + 3} fontSize={9} fill="var(--text-faint)">{tick(x.adj_logworth as number)}</text>
            </g>
          );
        })}
        <line x1={sx(0)} x2={sx(0)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" />
        <line x1={sx(ref)} x2={sx(ref)} y1={PAD.t} y2={H - PAD.b} stroke="var(--danger)" strokeDasharray="4 3" />
        <text x={sx(ref)} y={H - PAD.b + 12} textAnchor="middle" fontSize={9} fill="var(--danger)">{tick(ref)}</text>
        <text x={sx(0)} y={H - PAD.b + 12} textAnchor="middle" fontSize={9} fill="var(--text-faint)">0</text>
      </svg>
    </figure>
  );
}

function PValuePlot({ r }: { r: ResponseScreeningResult }) {
  const ps = r.results.map((x) => x.p).filter((p): p is number => p != null).sort((a, b) => a - b);
  if (ps.length === 0) return null;
  const m = ps.length;
  const lw = (p: number) => -Math.log10(Math.max(p, 1e-300));
  const H = 200;
  const bh = r.method === "bh";
  const ref = (i: number) => lw((r.alpha * i) / m);
  const ymax = Math.max(...ps.map(lw), bh ? ref(1) : 0, -Math.log10(r.alpha)) * 1.08 || 1;
  const sx = (i: number) => 40 + ((i - 1) / Math.max(1, m - 1)) * (W - 40 - PAD.r);
  const sy = (v: number) => PAD.t + (1 - v / ymax) * (H - PAD.t - PAD.b);
  return (
    <figure style={{ margin: "0 0 8px" }}>
      <figcaption className="qzk-field-lbl">
        p-value plot: -log10 p by rank{bh ? " · line: Benjamini-Hochberg alpha·i/m, points above it are discoveries up to the last crossing" : ""}
      </figcaption>
      <svg role="img" aria-label="p-value plot" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
        <line x1={40} x2={40} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" />
        <line x1={40} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} stroke="var(--border-strong)" />
        {[0, ymax / 2, ymax].map((v) => <text key={v} x={36} y={sy(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)">{tick(v)}</text>)}
        <text x={40} y={H - 8} fontSize={9} fill="var(--text-faint)">1</text>
        <text x={W - PAD.r} y={H - 8} fontSize={9} textAnchor="end" fill="var(--text-faint)">{m}</text>
        <text x={(40 + W - PAD.r) / 2} y={H - 8} fontSize={9} textAnchor="middle" fill="var(--text-faint)">rank (smallest p first)</text>
        {bh && (
          <path d={ps.map((_, i) => `${i === 0 ? "M" : "L"}${sx(i + 1).toFixed(1)},${sy(ref(i + 1)).toFixed(1)}`).join(" ")}
            fill="none" stroke="var(--danger)" strokeDasharray="4 3" />
        )}
        {!bh && <line x1={40} x2={W - PAD.r} y1={sy(-Math.log10(r.alpha))} y2={sy(-Math.log10(r.alpha))} stroke="var(--danger)" strokeDasharray="4 3" />}
        {ps.map((p, i) => <circle key={i} cx={sx(i + 1)} cy={sy(lw(p))} r={2.8} fill="var(--accent)" data-point />)}
      </svg>
    </figure>
  );
}

export default function ScreenView({ result }: { result: ResponseScreeningResult }) {
  return <><BarChart r={result} /><PValuePlot r={result} /></>;
}

/** The screening table with click-to-sort headers (numbers by value; blanks last). */
export function SortableTable({ table }: { table: ResultTable }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return table.rows;
    const { col, dir } = sort;
    return [...table.rows].sort((a, b) => {
      const [u, v] = [a[col], b[col]];
      if (u == null || u === "") return v == null || v === "" ? 0 : 1;
      if (v == null || v === "") return -1;
      return (typeof u === "number" && typeof v === "number" ? u - v : String(u).localeCompare(String(v))) * dir;
    });
  }, [table.rows, sort]);
  return (
    <table className="qz-table">
      <thead>
        <tr>
          {table.columns.map((c, i) => (
            <th key={c} aria-sort={sort?.col === i ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
              <button type="button" className="qz-linkbtn" style={{ font: "inherit", color: "inherit", background: "none", border: 0, padding: 0, cursor: "default" }}
                onClick={() => setSort((s) => (s?.col === i ? { col: i, dir: s.dir === 1 ? -1 : 1 } : { col: i, dir: 1 }))}>
                {c}{sort?.col === i ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{typeof v === "number" ? fmtNum(v) : (v ?? "—")}</td>)}</tr>)}
      </tbody>
    </table>
  );
}

