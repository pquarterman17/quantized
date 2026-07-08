// Closed-form PDFs for the curated distribution-fit families (ORIGIN_GAP #52
// item 6b — the Distribution workshop's fit-overlay). Evaluated client-side
// from the SAME params /api/stats/fit-distribution returns
// (calc/stats_dist.fit_distribution), so the drawn curve always agrees with
// the reported AIC/KS-p. Deliberately NOT chained through
// /api/statplots/histogram's own `fit=` overlay: that endpoint fits
// positive-support families with a free `loc`, while stats_dist fixes
// `loc=0` (the 2-parameter instrument-data convention) — chaining the two
// would draw a curve that doesn't match the reported best-fit family.

export type DistFamily = "normal" | "lognormal" | "weibull" | "gamma" | "exponential";

export const DIST_FAMILIES: DistFamily[] = [
  "normal",
  "lognormal",
  "weibull",
  "gamma",
  "exponential",
];

const TWO_PI = 2 * Math.PI;

// Lanczos approximation (g=7, n=9 coefficients) — accurate to ~15 significant
// digits for Re(z) > 0; used only for the gamma-distribution PDF's
// normalizing Γ(shape).
const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Γ(z) via the Lanczos approximation (reflection formula for z < 0.5). */
export function gammaFn(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  const zz = z - 1;
  let x = LANCZOS_COEF[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) x += LANCZOS_COEF[i] / (zz + i);
  const t = zz + LANCZOS_G + 0.5;
  return Math.sqrt(TWO_PI) * Math.pow(t, zz + 0.5) * Math.exp(-t) * x;
}

/** Evaluate the fitted pdf of `dist` at `x`, given the `params` object
 *  /api/stats/fit-distribution returns for that family. Returns 0 outside a
 *  family's support (x ≤ 0 for the positive-support families) and NaN when a
 *  required param is missing/non-positive. */
export function distPdf(dist: DistFamily, params: Record<string, number>, x: number): number {
  switch (dist) {
    case "normal": {
      const { mu, sigma } = params;
      if (!(sigma > 0)) return NaN;
      const z = (x - mu) / sigma;
      return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(TWO_PI));
    }
    case "lognormal": {
      if (x <= 0) return 0;
      const { mu, sigma } = params;
      if (!(sigma > 0)) return NaN;
      const z = (Math.log(x) - mu) / sigma;
      return Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(TWO_PI));
    }
    case "weibull": {
      if (x < 0) return 0;
      const { shape: k, scale: lambda } = params;
      if (!(k > 0) || !(lambda > 0)) return NaN;
      const xr = x / lambda;
      return (k / lambda) * Math.pow(xr, k - 1) * Math.exp(-Math.pow(xr, k));
    }
    case "gamma": {
      if (x <= 0) return 0;
      const { shape: k, scale: theta } = params;
      if (!(k > 0) || !(theta > 0)) return NaN;
      return (Math.pow(x, k - 1) * Math.exp(-x / theta)) / (Math.pow(theta, k) * gammaFn(k));
    }
    case "exponential": {
      if (x < 0) return 0;
      const { rate } = params;
      if (!(rate > 0)) return NaN;
      return rate * Math.exp(-rate * x);
    }
    default:
      return NaN;
  }
}

/** Sample the fitted pdf on `n` evenly-spaced points over [xMin, xMax] — the
 *  overlay curve drawn atop the histogram bars. Empty arrays for a degenerate
 *  domain. */
export function distPdfCurve(
  dist: DistFamily,
  params: Record<string, number>,
  xMin: number,
  xMax: number,
  n = 128,
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  if (!(xMax > xMin) || n < 2) return { x, y };
  const step = (xMax - xMin) / (n - 1);
  for (let i = 0; i < n; i++) {
    const xi = xMin + i * step;
    x.push(xi);
    y.push(distPdf(dist, params, xi));
  }
  return { x, y };
}

/** Build the SVG `points` attribute for a fitted-pdf curve overlaid on a
 *  COUNT histogram (not a density one): converts density → expected bar
 *  count (pdf · N · binWidth), then into the same 0–100 percentage box the
 *  DOM bars use (flex height %, bottom-aligned) so the two line up without
 *  any pixel math. `domain` is the histogram's [edges[0], edges[last]]. */
export function pdfOverlayPoints(
  curve: { x: number[]; y: number[] },
  domain: { lo: number; hi: number },
  binWidth: number,
  n: number,
  maxCount: number,
): string {
  if (!(domain.hi > domain.lo) || !(maxCount > 0) || curve.x.length === 0) return "";
  return curve.x
    .map((xi, i) => {
      const xPct = ((xi - domain.lo) / (domain.hi - domain.lo)) * 100;
      const count = curve.y[i] * n * binWidth;
      const yPct = Math.min(100, Math.max(0, (count / maxCount) * 100));
      return `${xPct.toFixed(3)},${(100 - yPct).toFixed(3)}`;
    })
    .join(" ");
}
