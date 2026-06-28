// Summary statistics over a dragged x-band of the plot ("statistics on
// selection"). Pure + client-side so the readout is live during the drag.
// Conventions match the backend descriptive_stats: sample std (ddof=1), NaN
// when n < 2.

/** Per-series summary over the selected x-band. `std` is NaN when n < 2. */
export interface SeriesStat {
  label: string;
  n: number;
  mean: number;
  std: number;
  median: number;
  min: number;
  max: number;
}

export interface RegionStats {
  xMin: number;
  xMax: number;
  series: SeriesStat[];
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Summarize every series over the x-band [x0,x1] (order-agnostic). `data` is
 *  uPlot AlignedData (data[0]=x, data[1..]=series); `labels` aligns to data[1..].
 *  `visible` (aligned to series) drops legend-hidden series. Skips null / non-
 *  finite points; returns null for a zero-width band or when no series has a
 *  point in range. */
export function computeRegionStats(
  data: readonly (readonly (number | null)[])[],
  labels: readonly string[],
  x0: number,
  x1: number,
  visible?: readonly boolean[],
): RegionStats | null {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  if (!(hi > lo) || data.length < 2) return null;

  const xs = data[0];
  const inBand: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x != null && Number.isFinite(x) && x >= lo && x <= hi) inBand.push(i);
  }

  const series: SeriesStat[] = [];
  for (let s = 1; s < data.length; s++) {
    if (visible && visible[s - 1] === false) continue;
    const col = data[s];
    const vals: number[] = [];
    for (const i of inBand) {
      const v = col[i];
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
    if (vals.length === 0) continue;
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const std =
      n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of vals) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    series.push({
      label: labels[s - 1] ?? `series ${s}`,
      n,
      mean,
      std,
      median: median([...vals].sort((a, b) => a - b)),
      min: mn,
      max: mx,
    });
  }
  return series.length ? { xMin: lo, xMax: hi, series } : null;
}
