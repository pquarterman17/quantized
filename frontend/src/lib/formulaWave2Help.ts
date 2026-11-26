// The "Insert function" entries (SetColumnValuesDialog's picker) for let(), the
// lookup/reference functions and the wave-2 element-wise functions
// (lib/formulaLet.ts, formulaLookup.ts, formulaSpecialFns.ts,
// formulaEngineering.ts). The label is the help text: signature plus the one
// fact a user would otherwise have to guess. formulaWave2.test.ts checks that
// every name of these families appears here.

export interface Wave2HelpEntry {
  label: string;
  /** Inserted at the cursor; `|` marks where the cursor goes after. */
  text: string;
}

const e = (label: string, text: string): Wave2HelpEntry => ({ label, text });

export const WAVE2_ENTRIES: Wave2HelpEntry[] = [
  e("let(name, value, …, expr) — names bound left to right; wins over a column of that name", "let(t, |, t * t)"),
  e("lookup(v, X, Y) — Y at the last X <= v (X ascending)", "lookup(|, A, B)"),
  e("xlookup(v, X, Y, notfound) — Y at the first exact X = v", "xlookup(|, A, B)"),
  e("match(v, X, type) — 1-based row; type 1 (ascending), 0 exact, -1 (descending)", "match(|, A, 0)"),
  e("index(Y, k) — Y at row k (1-based), like Y[k]", "index(|, 1)"),
  e("offset(A, k) — A at this row plus k (negative looks back)", "offset(|, -1)"),
  e("choose(k, a, b, …) — the k-th value (1-based)", "choose(|, 10, 20, 30)"),
  e("erfinv(y) / erfcinv(r) — inverse error functions", "erfinv(|)"),
  e("beta(a, b) / lbeta(a, b) — positive arguments only", "beta(|, 2)"),
  e("digamma(x) — psi(x), Gamma'/Gamma", "digamma(|)"),
  e("besselj(n, x) / bessely(n, x) — integer order n; Y needs x > 0", "besselj(0, |)"),
  e("sinc(x) — sin(pi x) / (pi x)", "sinc(|)"),
  e("clamp(v, lo, hi) / wrap(v, lo, hi) — limit / fold into [lo, hi)", "clamp(|, 0, 1)"),
  e("heaviside(v, h0) — 0 / h0 (default 0.5) / 1", "heaviside(|)"),
  e("todb(v) / fromdb(d) — amplitude dB: 20 log10", "todb(|)"),
  e("degrees(r) / radians(d)", "degrees(|)"),
  e("mod(a, b) — the sign of b, as Excel; trunc(v)", "mod(|, 360)"),
  e("fact(n) / combin(n, k) / permut(n, k) — whole numbers", "combin(|, 2)"),
  e("gcd(a, b) / lcm(a, b) — whole numbers", "gcd(|, 12)"),
  e("isnan(v) / ifnan(v, alt) / between(v, lo, hi)", "ifnan(|, 0)"),
  e("cbrt(v) / expm1(v) / log1p(v)", "cbrt(|)"),
];
