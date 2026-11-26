// Pure numeric kernels for the worksheet formula language's moving-window and
// column statistics (plan item 28, aggregate half). Parsing lives in
// lib/formulaStatCalls.ts; nothing here knows about formulas, only arrays.
//
// MISSING VALUES follow lib/formulaAggregates.ts ("omitnan"): non-finite
// entries are skipped, and a statistic over too few finite values is NaN.
//
// MOVING WINDOWS (movavg, movmedian, movrms, movsum, movsd, movslope).
// Row r uses the rows r-back .. r+fwd, clamped to the column: at the first
// and last rows the window is TRUNCATED, not padded or reflected, so the
// ends average fewer points. A blank (non-finite) cell inside the window is
// skipped, not counted. A row whose OWN cell is blank stays blank. Origin's
// Movavg(vd, back, forward[, missing, method]) and Movrms take the same back
// and forward counts; the install ships no text for its edge rule, so
// "truncated" is this app's stated choice, not a verified copy of Origin.
//
// emovavg(A, n): exponential average, alpha = 2 / (n + 1), seeded with the
// first finite value (so row 1 is A itself); a blank cell yields a blank and
// leaves the running value unchanged.
//
// COLUMN STATISTICS pair rows by position and drop every pair with a blank
// on either side. Covariance and correlation use the SAMPLE form (n - 1).

export type WindowKind = "avg" | "median" | "rms" | "sum" | "sd";

const finite = (v: number): boolean => Number.isFinite(v);

function mean(a: readonly number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

export function medianOf(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function reduceWindow(kind: WindowKind, w: number[]): number {
  if (w.length === 0) return NaN;
  switch (kind) {
    case "avg":
      return mean(w);
    case "sum":
      return w.reduce((s, v) => s + v, 0);
    case "rms":
      return Math.sqrt(w.reduce((s, v) => s + v * v, 0) / w.length);
    case "median":
      return medianOf([...w].sort((a, b) => a - b));
    case "sd": {
      if (w.length < 2) return NaN;
      const m = mean(w);
      return Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / (w.length - 1));
    }
  }
}

/** The whole result column of one moving-window statistic. */
export function movingWindow(kind: WindowKind, y: readonly number[], back: number, fwd: number): number[] {
  return y.map((own, r) => {
    if (!finite(own)) return NaN;
    const w: number[] = [];
    for (let i = Math.max(0, r - back); i <= Math.min(y.length - 1, r + fwd); i++) if (finite(y[i])) w.push(y[i]);
    return reduceWindow(kind, w);
  });
}

function pairs(a: readonly number[], b: readonly number[]): [number[], number[]] {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (finite(a[i]) && finite(b[i])) {
      x.push(a[i]);
      y.push(b[i]);
    }
  }
  return [x, y];
}

function sums(a: readonly number[], b: readonly number[]): { n: number; sxy: number; sxx: number; syy: number; mx: number; my: number } {
  const [x, y] = pairs(a, b);
  const n = x.length;
  const mx = n ? mean(x) : NaN;
  const my = n ? mean(y) : NaN;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return { n, sxy, sxx, syy, mx, my };
}

/** Least-squares slope of the finite (x, y) pairs; NaN below two pairs or with no spread in x. */
export function slopeOf(xs: readonly number[], ys: readonly number[]): number {
  const s = sums(xs, ys);
  return s.n >= 2 && s.sxx > 0 ? s.sxy / s.sxx : NaN;
}

/** Slope of `y` against `x` over each row's window (same edge rule as the other moving statistics). */
export function movingSlope(x: readonly number[], y: readonly number[], back: number, fwd: number): number[] {
  return y.map((own, r) => {
    if (!finite(own) || !finite(x[r])) return NaN;
    const lo = Math.max(0, r - back);
    const hi = Math.min(y.length - 1, r + fwd);
    return slopeOf(x.slice(lo, hi + 1), y.slice(lo, hi + 1));
  });
}

/** Exponential moving average, alpha = 2 / (n + 1). */
export function exponentialAverage(y: readonly number[], n: number): number[] {
  const alpha = 2 / (n + 1);
  let state = NaN;
  return y.map((v) => {
    if (!finite(v)) return NaN;
    state = Number.isNaN(state) ? v : alpha * v + (1 - alpha) * state;
    return state;
  });
}

export type PairStat = "correl" | "cov" | "slope" | "intercept";

/** `slope(X, Y)` / `intercept(X, Y)` take X first, as Origin's Slope(vx, vy)
 *  does; `correl` and `cov` are symmetric. */
export function pairStat(kind: PairStat, a: readonly number[], b: readonly number[]): number {
  if (kind === "slope") return slopeOf(a, b);
  const s = sums(a, b);
  if (s.n < 2) return NaN;
  if (kind === "cov") return s.sxy / (s.n - 1);
  if (kind === "correl") return s.sxx > 0 && s.syy > 0 ? s.sxy / Math.sqrt(s.sxx * s.syy) : NaN;
  return s.sxx > 0 ? s.my - (s.sxy / s.sxx) * s.mx : NaN; // intercept
}

/** Percentile `p` (0..100) by linear interpolation between order statistics
 *  (numpy's default, Excel's PERCENTILE.INC). NaN when `p` is outside 0..100. */
export function percentileOf(values: readonly number[], p: number): number {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (v.length === 0 || !(p >= 0 && p <= 100)) return NaN;
  const pos = ((v.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export type ColumnStat = "skew" | "kurt" | "geomean" | "harmean" | "mad" | "mode";

/** One-column statistics. skew/kurt are the bias-corrected sample forms
 *  Excel's SKEW/KURT use (kurt is EXCESS kurtosis); they need 3 and 4 values.
 *  geomean/harmean need every value > 0. mad is the median absolute
 *  deviation from the median, unscaled. mode is the most frequent value (the
 *  smallest on a tie) and NaN when no value repeats. */
export function columnStat(kind: ColumnStat, values: readonly number[]): number {
  const v = values.filter(finite);
  const n = v.length;
  if (n === 0) return NaN;
  switch (kind) {
    case "skew":
    case "kurt": {
      if (n < (kind === "skew" ? 3 : 4)) return NaN;
      const m = mean(v);
      const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
      if (!(sd > 0)) return NaN;
      if (kind === "skew") return (n / ((n - 1) * (n - 2))) * v.reduce((s, x) => s + ((x - m) / sd) ** 3, 0);
      const f4 = v.reduce((s, x) => s + ((x - m) / sd) ** 4, 0);
      return (n * (n + 1) * f4) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
    }
    case "geomean":
      return v.every((x) => x > 0) ? Math.exp(v.reduce((s, x) => s + Math.log(x), 0) / n) : NaN;
    case "harmean":
      return v.every((x) => x > 0) ? n / v.reduce((s, x) => s + 1 / x, 0) : NaN;
    case "mad": {
      const med = medianOf([...v].sort((a, b) => a - b));
      return medianOf(v.map((x) => Math.abs(x - med)).sort((a, b) => a - b));
    }
    case "mode": {
      const counts = new Map<number, number>();
      for (const x of v) {
        const k = x === 0 ? 0 : x; // -0 and 0 are one value
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let best = NaN;
      let bestN = 1;
      for (const [x, c] of counts) if (c > bestN || (c === bestN && c > 1 && x < best)) [best, bestN] = [x, c];
      return best;
    }
  }
}
