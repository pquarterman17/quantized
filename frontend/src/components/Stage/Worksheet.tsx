// Read-only worksheet preview of the active dataset (x + value channels).
// The interactive workspace (roles, formulas, sort/filter) is Tier 2 / W5.

import { useActiveDataset } from "../../store/useApp";

const MAX_ROWS = 200;

export default function Worksheet() {
  const active = useActiveDataset();
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

  return (
    <div className="qzk-sheet">
      <table>
        <thead>
          <tr>
            <th className="rownum">#</th>
            <th>
              {xName}
              <span className="role">X{xUnit ? ` · ${xUnit}` : ""}</span>
            </th>
            {labels.map((lab, c) => (
              <th key={lab}>
                {lab}
                <span className="role">
                  Y{units[c] ? ` · ${units[c]}` : ""}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, r) => (
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
  return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0)
    ? v.toExponential(3)
    : v.toFixed(4);
}
