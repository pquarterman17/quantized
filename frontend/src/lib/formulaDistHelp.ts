// The function-picker entries (Set Column Values dialog) for the distribution
// functions of lib/formulaDist.ts, each carrying its parameterisation so the
// list is its own help. Kept out of lib/setColumnValues.ts (a big file) and
// pinned to DIST_NAMES by formulaDist.test.ts: every name has an entry.

export interface DistEntry {
  label: string;
  /** Inserted at the cursor; `|` marks where the cursor goes after. */
  text: string;
}

const e = (label: string, text: string): DistEntry => ({ label, text });

export const DIST_ENTRIES: DistEntry[] = [
  e("normpdf(x, mu, sigma) — normal density", "normpdf(|, 0, 1)"),
  e("normcdf(x, tail) — STANDARD normal cdf; tail 2 lower (default), 1 upper", "normcdf(|)"),
  e("norminv(p) — standard normal quantile", "norminv(|)"),
  e("tpdf(x, df) — Student t density", "tpdf(|, 10)"),
  e("tcdf(t, df, tail) — Student t cdf", "tcdf(|, 10)"),
  e("tinv(p, df) — Student t quantile", "tinv(|, 10)"),
  e("chi2pdf(x, df) — chi-square density", "chi2pdf(|, 3)"),
  e("chi2cdf(x, df, tail) — chi-square cdf", "chi2cdf(|, 3)"),
  e("chi2inv(p, df) — chi-square quantile", "chi2inv(|, 3)"),
  e("fpdf(x, df1, df2) — F density", "fpdf(|, 4, 10)"),
  e("fcdf(f, df1, df2, tail) — F cdf", "fcdf(|, 4, 10)"),
  e("finv(p, df1, df2) — F quantile", "finv(|, 4, 10)"),
  e("gampdf(x, a, b) — gamma density, shape a, scale b", "gampdf(|, 2, 1)"),
  e("gamcdf(x, a, b, tail) — gamma cdf, shape a, scale b", "gamcdf(|, 2, 1)"),
  e("gaminv(p, a, b) — gamma quantile, shape a, scale b", "gaminv(|, 2, 1)"),
  e("betapdf(x, a, b) — beta density on [0, 1]", "betapdf(|, 2, 3)"),
  e("betacdf(x, a, b, tail) — beta cdf", "betacdf(|, 2, 3)"),
  e("betainv(p, a, b) — beta quantile", "betainv(|, 2, 3)"),
  e("lognpdf(x, mu, sigma) — lognormal density; mu, sigma of ln(x)", "lognpdf(|, 0, 1)"),
  e("logncdf(x, mu, sigma, tail) — lognormal cdf", "logncdf(|, 0, 1)"),
  e("logninv(p, mu, sigma) — lognormal quantile", "logninv(|, 0, 1)"),
  e("wblpdf(x, a, b) — Weibull density, scale a, shape b", "wblpdf(|, 1, 2)"),
  e("wblcdf(x, a, b) — Weibull cdf, scale a, shape b", "wblcdf(|, 1, 2)"),
  e("wblinv(p, a, b) — Weibull quantile, scale a, shape b", "wblinv(|, 1, 2)"),
  e("exppdf(x, lambda) — exponential density, RATE lambda", "exppdf(|, 1)"),
  e("expcdf(x, lambda, tail) — exponential cdf, rate lambda", "expcdf(|, 1)"),
  e("expinv(p, lambda) — exponential quantile, rate lambda", "expinv(|, 1)"),
  e("poisspdf(k, lambda) — Poisson probability of k", "poisspdf(|, 3)"),
  e("poisscdf(k, lambda) — Poisson P(K <= k)", "poisscdf(|, 3)"),
  e("binopdf(k, n, p) — binomial probability of k", "binopdf(|, 10, 0.5)"),
  e("binocdf(k, n, p) — binomial P(K <= k)", "binocdf(|, 10, 0.5)"),
];
