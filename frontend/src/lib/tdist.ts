// Two-sided Student's-t critical values for the box/strip mean+-95% CI
// marker (JMP_GAP J5 #2): a pure numerical implementation (log-gamma +
// Numerical-Recipes continued-fraction incomplete beta + bisection) so the
// OFFLINE client fallback (statstage.ts's boxStatsClient) can compute a CI
// without a round trip. The backend delegates to `scipy.stats.t.ppf`
// directly (a standard published algorithm -- CLAUDE.md's "delegate to
// scipy" rule, not the "replicate the idiosyncratic algorithm" rule); this
// module reproduces its ANSWER to ~1e-9 relative precision without
// depending on it, the exact same shadow relationship `boxStatsClient`'s
// quartiles already have with `numpy.percentile` (cross-checked in
// tdist.test.ts against scipy oracle values for a spread of df).

/** Lanczos approximation (g=7, n=9) -- the standard reference log-gamma. */
function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  const xm1 = x - 1;
  let a = c[0];
  const t = xm1 + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (xm1 + i);
  return 0.5 * Math.log(2 * Math.PI) + (xm1 + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes'
 *  `betacf`). */
function betacf(x: number, a: number, b: number): number {
  const MAXIT = 200;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b), x in [0,1]. */
function betainc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** Two-sided Student's-t CDF: P(|T| <= t) for `df` degrees of freedom. */
function tTwoSidedCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  return 1 - betainc(x, df / 2, 0.5);
}

/** Two-sided critical value t* such that P(|T| <= t*) = 1 - alpha (e.g.
 *  alpha=0.05 -> the classic 95% CI multiplier). Bisection over the
 *  monotonic two-sided CDF -- robust for any df >= 1, no derivative needed. */
export function tCriticalTwoSided(df: number, alpha = 0.05): number {
  if (!Number.isFinite(df) || df < 1) return NaN;
  const target = 1 - alpha;
  let lo = 0;
  let hi = 1e6; // this large a t is indistinguishable from the normal limit
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedCdf(mid, df) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The 95% two-sided critical value -- the box/strip mean+-CI marker's default. */
export function tCritical95(df: number): number {
  return tCriticalTwoSided(df, 0.05);
}
