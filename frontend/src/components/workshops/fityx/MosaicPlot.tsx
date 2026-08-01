// Fit Y by X — contingency leg's mosaic plot (JMP_GAP_PLAN J3 residual: "mosaic
// plot proper", the cross-tab table already ships in ContingencyView). Pure
// client-side SVG derived from the SAME rowLabels/colLabels/table the counts
// table renders -- no backend call needed. JMP convention: X-level (rowLabels,
// the platform's X factor) columns sized by width proportional to that level's
// share of N; within each column, Y-level (colLabels) segments stack with
// height proportional to the CONDITIONAL distribution of Y given that X level.

import { seriesColor } from "../../../lib/uplotOpts";

const W = 320;
const H = 170;
const LABEL_BAND = 20;
const PAD = 4;
const GAP = 2;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export default function MosaicPlot({
  rowLabels,
  colLabels,
  table,
}: {
  rowLabels: string[];
  colLabels: string[];
  table: number[][];
}) {
  const rowTotals = table.map((row) => row.reduce((a, b) => a + b, 0));
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);
  if (grandTotal <= 0) return null;

  const innerW = W - 2 * PAD;
  const innerH = H - 2 * PAD;

  let x = PAD;
  const columns = rowLabels.map((label, i) => {
    const total = rowTotals[i];
    const width = (total / grandTotal) * innerW;
    const col = { label, x, width, total, i };
    x += width;
    return col;
  });

  return (
    <div style={{ marginTop: 8 }}>
      <svg
        role="img"
        aria-label="mosaic plot"
        width={W}
        height={H + LABEL_BAND}
        style={{ background: "var(--surface-3)" }}
      >
        {columns.map((col) => {
          let y = PAD;
          return (
            <g key={col.label}>
              {colLabels.map((clab, j) => {
                const count = table[col.i][j];
                const h = col.total > 0 ? (count / col.total) * innerH : 0;
                const rect = (
                  <rect
                    key={clab}
                    x={col.x}
                    y={y}
                    width={Math.max(col.width - GAP, 0)}
                    height={Math.max(h - GAP, 0)}
                    fill={seriesColor(j)}
                    opacity={0.85}
                  >
                    <title>
                      {`${col.label} x ${clab}: ${count} (${col.total > 0 ? ((count / col.total) * 100).toFixed(1) : "0.0"}% of ${col.label})`}
                    </title>
                  </rect>
                );
                y += h;
                return rect;
              })}
              <text
                x={col.x + col.width / 2}
                y={H + 12}
                textAnchor="middle"
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill="var(--text-faint)"
              >
                {truncate(col.label, Math.max(3, Math.round(col.width / 6)))}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        {colLabels.map((clab, j) => (
          <span
            key={clab}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-faint)" }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                background: seriesColor(j),
                display: "inline-block",
                borderRadius: 2,
              }}
            />
            {clab}
          </span>
        ))}
      </div>
    </div>
  );
}
