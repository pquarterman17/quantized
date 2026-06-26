// Worksheet view of the active dataset: click a header to sort, and add a
// computed column with a formula (e.g. "2*A + sqrt(B)") over x + the channels
// A, B, C … The computed column lands as a derived dataset in the library.

import { useMemo, useState } from "react";

import { channelLetter, compileFormula } from "../../lib/formula";
import type { DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";

const MAX_ROWS = 500;
let _seq = 0;

export default function Worksheet() {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [formula, setFormula] = useState("");
  const [colName, setColName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Row order for the current sort (col = -1 is the x column). Non-finite last.
  const order = useMemo(() => {
    const n = active?.data.time.length ?? 0;
    const idx = Array.from({ length: n }, (_, i) => i);
    if (!active || !sort) return idx;
    const key = (r: number) =>
      sort.col < 0 ? active.data.time[r] : active.data.values[r]?.[sort.col];
    return idx.sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      if (!Number.isFinite(va)) return 1;
      if (!Number.isFinite(vb)) return -1;
      return (va - vb) * sort.dir;
    });
  }, [active, sort]);

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
  const n = Math.min(time.length, MAX_ROWS);

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
        <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          vars: {vars}
        </span>
      </div>
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
              <th key={lab} onClick={() => toggleSort(c)} title={channelLetter(c)} style={{ cursor: "default" }}>
                {lab}
                <span className="role">
                  {channelLetter(c)}
                  {units[c] ? ` · ${units[c]}` : ""}
                  {mark(c)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.slice(0, n).map((r) => (
            <tr key={r}>
              <td className="rownum">{r + 1}</td>
              <td>{fmt(time[r])}</td>
              {labels.map((lab, c) => (
                <td key={lab}>{fmt(values[r]?.[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {time.length > MAX_ROWS && (
        <div className="qzk-ds-meta" style={{ padding: 8 }}>
          showing {MAX_ROWS} of {time.length} rows
        </div>
      )}
    </div>
  );
}

function fmt(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(4);
}
