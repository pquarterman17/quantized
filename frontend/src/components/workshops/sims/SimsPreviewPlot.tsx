// SIMS workshop — the live preview: every species of the PROCESSED profile on
// a log-y axis (the SIMS convention), one colour token per column. A
// dependency-free SVG, so the lazy workshop chunk stays small; values <= 0
// have no place on a log axis and are skipped (the backend's `non-positive`
// warning counts them). Decimated per column via the main plot's
// `decimateRowIndices` so a long profile never stringifies a huge path.
// `offsets` (the Compare tab's stagger) shifts column c by offsets[c] decades,
// exactly as the plot will draw it (lib/logOffset.ts), and says so in the key.

import { useMemo } from "react";

import { logOffsetSuffix } from "../../../lib/logOffset";
import { decimateRowIndices, xExtent } from "../../../lib/plotDecimate";
import type { DataStruct } from "../../../lib/types";

const W = 300;
const H = 150;
const PAD = 6;
const BUCKETS = W;
/** The colour tokens cycle after this many series. */
const N_SERIES_TOKENS = 8;

type Pt = [number, number];

function logPairs(d: DataStruct, c: number, decades: number): Pt[] {
  const ys = d.values.map((row) => (typeof row?.[c] === "number" ? row[c] : null));
  const out: Pt[] = [];
  for (const i of decimateRowIndices([ys], 0, d.time.length, BUCKETS)) {
    const x = d.time[i];
    const y = ys[i];
    if (Number.isFinite(x) && typeof y === "number" && y > 0 && Number.isFinite(y)) out.push([x, Math.log10(y) + decades]);
  }
  return out;
}

export default function SimsPreviewPlot({ data, offsets }: { data: DataStruct; offsets?: readonly number[] }) {
  const series = useMemo(() => data.labels.map((_, c) => logPairs(data, c, offsets?.[c] ?? 0)), [data, offsets]);
  const all = series.flat();
  if (!all.length) {
    return <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>No positive values to plot on a log axis.</div>;
  }
  const xr = xExtent(data.time) ?? [0, 1];
  const [x0, x1] = xr[0] === xr[1] ? [xr[0] - 1, xr[1] + 1] : xr;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [, y] of all) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (y0 === y1) {
    y0 -= 1;
    y1 += 1;
  }
  const sx = (x: number) => PAD + ((x - x0) / (x1 - x0)) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y - y0) / (y1 - y0)) * (H - 2 * PAD);
  return (
    <figure style={{ margin: "6px 0 0" }}>
      <svg
        role="img"
        aria-label={`Processed profile, log scale: ${data.labels.length} species, 10^${y0.toFixed(1)} to 10^${y1.toFixed(1)}`}
        data-testid="sims-preview-plot"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", background: "var(--surface-sunken, var(--bg))", borderRadius: 4 }}
      >
        {series.map((pts, c) => (
          <polyline
            key={c}
            points={pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={`var(--series-${(c % N_SERIES_TOKENS) + 1})`}
            strokeWidth={1.2}
          />
        ))}
      </svg>
      <figcaption className="qzk-ds-meta" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
        {data.labels.map((l, c) => (
          <span key={c} style={{ color: `var(--series-${(c % N_SERIES_TOKENS) + 1})` }}>
            ― {l || `column ${c + 1}`}{logOffsetSuffix(offsets?.[c] ?? 0)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
