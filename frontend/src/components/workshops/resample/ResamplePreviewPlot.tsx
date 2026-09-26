// Resample / align workshop — the live overlay: the source channel as a line,
// the resampled points as markers on top (a line when there are too many to
// mark). A dependency-free SVG, so the lazy workshop chunk stays small; the
// point is to SEE where the new grid lands, blanks and all, before creating.
//
// Decimated (min/max per bucket, ~one per pixel column) via the same
// `decimateRowIndices` the main plot's dense-sweep path uses: a 200k-row
// align preview would otherwise stringify a 300k-coordinate SVG `points`
// attribute on every render. The axis EXTENT is still read off the full
// columns (a single O(n) scan, no array copies) so the true min/max is never
// lost to decimation.

import { useMemo } from "react";

import { decimateRowIndices, xExtent } from "../../../lib/plotDecimate";
import type { DataStruct } from "../../../lib/types";

const W = 300;
const H = 140;
const PAD = 6;
/** Above this many resampled points, draw a line instead of markers. */
const MAX_MARKERS = 300;
/** Decimation target: about one bucket per plotted pixel column. */
const BUCKETS = W;

type Pt = [number, number];

function channelColumn(d: DataStruct, channel: number): (number | null)[] {
  return d.values.map((row) => (typeof row?.[channel] === "number" ? row[channel] : null));
}

/** The finite (x, y) pairs for `channel`, decimated to about `BUCKETS`
 *  points -- every series contributes its own min/max per bucket, so a real
 *  extremum (a spike, a blank-output gap's edge) always survives. */
function decimatedPairs(d: DataStruct, channel: number): Pt[] {
  const n = d.time.length;
  if (!n) return [];
  const ys = channelColumn(d, channel);
  const out: Pt[] = [];
  for (const i of decimateRowIndices([ys], 0, n, BUCKETS)) {
    const x = d.time[i];
    const y = ys[i];
    if (Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

/** The channel's finite [min, max] over the FULL (undecimated) column -- a
 *  single pass, no intermediate array -- so the axis scale is always exact
 *  regardless of decimation. */
function channelExtent(d: DataStruct, channel: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of d.values) {
    const y = row?.[channel];
    if (typeof y === "number" && Number.isFinite(y)) {
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** The tighter bound of two extents, skipping whichever is absent. */
function union(a: [number, number] | null, b: [number, number] | null): [number, number] | null {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}

/** [min, max], widened when it collapses to a single value or is absent. */
function widen(range: [number, number] | null): [number, number] {
  if (!range) return [0, 1];
  const [lo, hi] = range;
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

function finiteCount(d: DataStruct, channel: number): number {
  let n = 0;
  for (let i = 0; i < d.time.length; i++) {
    const y = d.values[i]?.[channel];
    if (Number.isFinite(d.time[i]) && typeof y === "number" && Number.isFinite(y)) n++;
  }
  return n;
}

export default function ResamplePreviewPlot({
  source,
  result,
  channel,
}: {
  source: DataStruct;
  result: DataStruct;
  channel: number;
}) {
  const { src, out } = useMemo(
    () => ({ src: decimatedPairs(source, channel), out: decimatedPairs(result, channel) }),
    [source, result, channel],
  );
  if (!src.length && !out.length) {
    return <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>Nothing to plot in this column.</div>;
  }
  // x spans the resampled grid too (its full range, not just the decimated
  // points), so a blank (out-of-range) target still widens the axis and the
  // gap it leaves is visible.
  const [x0, x1] = widen(union(xExtent(source.time), xExtent(result.time)));
  const [y0, y1] = widen(union(channelExtent(source, channel), channelExtent(result, channel)));
  const sx = (x: number) => PAD + ((x - x0) / (x1 - x0)) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y - y0) / (y1 - y0)) * (H - 2 * PAD);
  const path = (pts: Pt[]) => pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");

  return (
    <svg
      role="img"
      aria-label={`Preview: ${finiteCount(source, channel)} source points, ${finiteCount(result, channel)} resampled points`}
      data-testid="resample-preview-plot"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: "block", background: "var(--surface-sunken, var(--bg))", borderRadius: 4, marginTop: 6 }}
    >
      <polyline points={path(src)} fill="none" stroke="var(--series-1)" strokeWidth={1.2} opacity={0.7} />
      {out.length > MAX_MARKERS ? (
        <polyline points={path(out)} fill="none" stroke="var(--series-2)" strokeWidth={1.2} strokeDasharray="3 2" />
      ) : (
        out.map(([x, y], i) => (
          <circle key={i} cx={sx(x)} cy={sy(y)} r={1.8} fill="var(--series-2)" data-resampled-point="" />
        ))
      )}
    </svg>
  );
}
