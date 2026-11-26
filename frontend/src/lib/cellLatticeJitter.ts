// Axis clustering for a stage scan whose positions are jittered: the stage
// lands near each lattice point, not on it, so every coordinate is a little
// different and exact matching (lib/cellLabelsNative.ts `distinct`) sees
// hundreds of axis values. Pure. Used only when the exact reading finds no
// lattice, so a scan that already read as one is never changed.
//
// METHOD (per axis). Sort the values; the positive gaps then fall in two
// groups, the jitter gaps (inside one lattice point) and the step gaps
// (between points), split at the largest gap-to-gap ratio of at least 3. The
// median clear gap M is the median of the upper group. Values chain into one
// lattice coordinate while the gap stays within 0.5 M, and a cluster wider than
// 0.4 of the pitch (the median distance between cluster centres; jitter up to
// about +-0.2 of the step) is not a lattice coordinate: the whole axis is refused. No split at all means no jitter: values merge only
// within a part in a billion of the span, as the exact reading does.
// Each lattice coordinate is the MEAN of its cluster.

/** More distinct values than this on an axis: not a scan lattice (every cell would be a sliver). */
export const MAX_LATTICE_AXIS = 400;

/** More rows than this are not clustered (the walk sorts them): a big cloud is not a stage scan. */
export const MAX_JITTER_ROWS = 20000;
const SPLIT_RATIO = 3;
const BREAK_FRACTION = 0.5;
const MAX_WIDTH_FRACTION = 0.4;

export interface AxisClusters {
  /** Ascending cluster centres (the mean of each cluster's values). */
  axis: number[];
  /** The cluster a value belongs to. */
  index: (v: number) => number;
}

const median = (a: readonly number[]): number => {
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** The lattice coordinates of `col` clustered as described above, or null. */
export function clusterAxis(col: readonly number[], span: number): AxisClusters | null {
  if (col.length > MAX_JITTER_ROWS || !(span > 0)) return null;
  const s = [...col].sort((a, b) => a - b);
  const tiny = span * 1e-9;
  const gaps: number[] = [];
  for (let k = 1; k < s.length; k++) if (s[k] - s[k - 1] > tiny) gaps.push(s[k] - s[k - 1]);
  if (gaps.length === 0) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  let split = -1;
  let best = SPLIT_RATIO;
  for (let k = 0; k + 1 < sorted.length; k++) {
    if (sorted[k + 1] / sorted[k] >= best) {
      best = sorted[k + 1] / sorted[k];
      split = k;
    }
  }
  const step = split < 0 ? 0 : median(sorted.slice(split + 1));
  const cutoff = split < 0 ? tiny : BREAK_FRACTION * step;
  const groups: number[][] = [[s[0]]];
  for (let k = 1; k < s.length; k++) {
    if (s[k] - s[k - 1] > cutoff) groups.push([]);
    groups[groups.length - 1].push(s[k]);
    if (groups.length > MAX_LATTICE_AXIS) return null;
  }
  if (groups.length < 2) return null;
  const centres = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const pitch = median(centres.slice(1).map((c, k) => c - centres[k]).sort((a, b) => a - b));
  if (split >= 0 && groups.some((g) => g[g.length - 1] - g[0] > MAX_WIDTH_FRACTION * pitch)) return null;
  const cuts = groups.slice(1).map((g, k) => (groups[k][groups[k].length - 1] + g[0]) / 2);
  return {
    axis: centres,
    index: (v) => {
      let lo = 0;
      let hi = cuts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cuts[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
}
