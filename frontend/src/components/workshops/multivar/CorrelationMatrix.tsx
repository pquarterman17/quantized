// Multivariate workbench (JMP_GAP J10) — correlation matrix view. An n×n DOM
// grid (cheap at the small column counts this platform targets, and directly
// RTL-testable — HistogramStrip's "DOM not canvas" precedent) coloured by r
// via the diverging RDBU colormap (lib/colormap.diverging — a fixed scale
// independent of theme, matching the sequential map-viewer colormaps). Each
// cell shows r to 3 places; its title attribute carries the exact r and the
// 2-tailed p-value for hover.

import { cellInk, diverging } from "../../../lib/colormap";
import { fmtNum } from "../../../lib/format";
import type { CorrelationResponse } from "../../../lib/api";

export interface CorrelationMatrixProps {
  labels: string[];
  corr: CorrelationResponse;
}

export default function CorrelationMatrix({ labels, corr }: CorrelationMatrixProps) {
  const n = labels.length;
  return (
    <div
      className="qzk-corr-grid"
      role="table"
      aria-label="correlation matrix"
      style={{
        display: "grid",
        gridTemplateColumns: `minmax(50px, auto) repeat(${n}, minmax(36px, 1fr))`,
        gap: 1,
        fontSize: 10,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div />
      {labels.map((lab, j) => (
        <div
          key={`h-${j}`}
          title={lab}
          style={{
            textAlign: "center",
            color: "var(--text-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "2px 1px",
          }}
        >
          {lab}
        </div>
      ))}
      {labels.map((rowLab, i) => (
        <div style={{ display: "contents" }} key={`row-${i}`}>
          <div
            title={rowLab}
            style={{
              textAlign: "right",
              color: "var(--text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: "2px 4px",
            }}
          >
            {rowLab}
          </div>
          {labels.map((colLab, j) => {
            const r = corr.r[i]?.[j] ?? NaN;
            const p = corr.p[i]?.[j] ?? NaN;
            const rgb = Number.isFinite(r) ? diverging(r) : null;
            return (
              <div
                key={`c-${i}-${j}`}
                role="cell"
                title={`${rowLab} × ${colLab}: r=${fmtNum(r)}, p=${fmtNum(p)}`}
                style={{
                  background: rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : "var(--surface-2)",
                  color: rgb ? cellInk(rgb) : "var(--text-faint)",
                  textAlign: "center",
                  padding: "3px 2px",
                  borderRadius: 2,
                }}
              >
                {fmtNum(r)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
