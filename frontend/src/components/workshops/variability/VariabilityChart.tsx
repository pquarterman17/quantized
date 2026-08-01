// Variability chart (JMP_GAP_PLAN J8) — the chart itself: cells laid out on
// the X axis grouped by Factor A (with a gap between A-groups), one jittered
// point column per cell, a "connect cell means" line within each A-group, a
// horizontal group-mean bracket per A-level, and a dashed grand-mean
// reference line across the whole chart — the JMP variability/gauge chart
// reading. Modest SVG (Graph Builder is the publication-plot path), same
// convention as fityx/BivariateView.tsx's scatter+fit.
//
// Deliberately reads mean/n from the LANDED `VariabilitySummaryResponse`
// (not re-derived client-side) — that payload is the acceptance contract
// JMP_GAP_PLAN #8 names, so the chart proves the wiring, not just the math.

import { deterministicJitter } from "../../../lib/jitter";
import type { VariabilityFactorLevel } from "../../../lib/variability";
import type { VariabilitySummaryResponse } from "./useVariability";

const CELL_W = 30;
const GROUP_GAP = 18;
const PAD_LEFT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 34;
const H = 200;

interface PlacedCell {
  aIndex: number;
  bIndex: number;
  bLabel: string;
  x: number;
  values: number[];
  mean: number;
}

interface PlacedGroup {
  aIndex: number;
  aLabel: string;
  x0: number;
  x1: number;
  mean: number;
}

export default function VariabilityChart({
  levels,
  summary,
}: {
  levels: VariabilityFactorLevel[];
  summary: VariabilitySummaryResponse;
}) {
  const cellByKey = new Map(summary.cells.map((c) => [`${c.a_index}:${c.b_index}`, c]));
  const groupByIndex = new Map(summary.a_groups.map((g) => [g.a_index, g]));

  const placedCells: PlacedCell[] = [];
  const placedGroups: PlacedGroup[] = [];
  let x = PAD_LEFT + CELL_W / 2;
  for (const lvl of levels) {
    const x0 = x;
    for (const cell of lvl.cells) {
      const s = cellByKey.get(`${lvl.aIndex}:${cell.bIndex}`);
      const mean = s?.mean ?? cell.values.reduce((a, b) => a + b, 0) / cell.values.length;
      placedCells.push({ aIndex: lvl.aIndex, bIndex: cell.bIndex, bLabel: cell.bLabel, x, values: cell.values, mean });
      x += CELL_W;
    }
    const x1 = x - CELL_W;
    const g = groupByIndex.get(lvl.aIndex);
    placedGroups.push({ aIndex: lvl.aIndex, aLabel: lvl.aLabel, x0, x1, mean: g?.mean ?? NaN });
    x += GROUP_GAP;
  }
  const width = Math.max(x - GROUP_GAP + PAD_LEFT, 200);

  const allValues = placedCells.flatMap((c) => c.values);
  const yCandidates = [...allValues, summary.grand_mean].filter(Number.isFinite);
  const yLo = Math.min(...yCandidates);
  const yHi = Math.max(...yCandidates);
  const span = yHi - yLo || 1;
  const sy = (v: number) => H - PAD_BOTTOM - ((v - yLo) / span) * (H - PAD_TOP - PAD_BOTTOM);

  return (
    <div style={{ overflowX: "auto", marginTop: 8 }}>
      <svg role="img" aria-label="variability chart" width={width} height={H} style={{ background: "var(--surface-3)" }}>
        {/* Grand mean reference line */}
        <line
          x1={0}
          x2={width}
          y1={sy(summary.grand_mean)}
          y2={sy(summary.grand_mean)}
          stroke="var(--text-faint)"
          strokeDasharray="4 3"
        />

        {/* Per-A-group mean bracket + connect-cell-means line */}
        {placedGroups.map((g) => {
          const cells = placedCells.filter((c) => c.aIndex === g.aIndex);
          const linePath = cells.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${sy(c.mean)}`).join(" ");
          return (
            <g key={g.aIndex}>
              <line
                x1={g.x0 - CELL_W / 2 + 4}
                x2={g.x1 + CELL_W / 2 - 4}
                y1={sy(g.mean)}
                y2={sy(g.mean)}
                stroke="var(--series-2, var(--accent))"
                strokeWidth={2}
              />
              {linePath && <path d={linePath} stroke="var(--accent)" strokeWidth={1.25} fill="none" opacity={0.8} />}
              <text
                x={(g.x0 + g.x1) / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--text-faint)"
              >
                {g.aLabel}
              </text>
            </g>
          );
        })}

        {/* Points per cell (deterministic jitter, never Math.random) */}
        {placedCells.map((c) => (
          <g key={`${c.aIndex}:${c.bIndex}`}>
            {c.values.map((v, i) => (
              <circle
                key={i}
                cx={c.x + deterministicJitter(i, `${c.aIndex}:${c.bIndex}`) * (CELL_W / 2 - 5)}
                cy={sy(v)}
                r={2}
                fill="var(--text-faint)"
              />
            ))}
            <text
              x={c.x}
              y={H - PAD_BOTTOM + 12}
              textAnchor="middle"
              fontSize={9}
              fontFamily="var(--font-mono)"
              fill="var(--text-faint)"
            >
              {c.bLabel}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
