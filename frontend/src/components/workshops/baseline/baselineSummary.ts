// One-line numeric summary of a baseline estimate, shared by Baseline's By
// levels and its worksheet batch: [baseline min, baseline max, residual RMS of
// y - baseline over the points where the baseline is finite].

export function baselineSummary(y: readonly number[], baseline: readonly (number | null)[]): [number, number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  let sq = 0;
  let count = 0;
  for (let i = 0; i < y.length; i++) {
    const v = baseline[i];
    if (v == null || !Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    sq += (y[i]! - v) ** 2;
    count++;
  }
  if (count === 0) throw new Error("the estimator returned no finite baseline");
  return [lo, hi, Math.sqrt(sq / count)];
}

export const BASELINE_SUMMARY_HEADERS = ["Baseline min", "Baseline max", "Residual RMS"] as const;
