// Smart auto-scale (#17): pick log vs linear from a series' dynamic range. The
// MATLAB btnSmartScale rule — if the data is strictly positive and spans many
// decades, log reads better (reflectivity, SAXS); otherwise linear.

const DECADE_THRESHOLD = 100; // ≥ 2 decades of positive span → suggest log

/** Should this set of values be plotted on a log axis? True only when every
 *  finite value is > 0 and max/min spans at least two decades. */
export function suggestLogScale(values: Iterable<number | null | undefined>): boolean {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v <= 0) return false; // any non-positive value rules out log
    n += 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (n === 0) return false;
  return max / min >= DECADE_THRESHOLD;
}
