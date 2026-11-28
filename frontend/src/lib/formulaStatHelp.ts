// The "Insert function" entries (SetColumnValuesDialog's picker) for the
// moving-window, column-statistic and conditional-aggregate functions
// (lib/formulaStatCalls.ts). The label is the help text: signature plus the
// one fact a user would otherwise have to guess (edge rule, argument order,
// units). A test checks every function of the family appears here.

export interface StatHelpEntry {
  label: string;
  /** Inserted at the cursor; `|` marks where the cursor goes after. */
  text: string;
}

export const STAT_ENTRIES: StatHelpEntry[] = [
  { label: "movavg(A, back, fwd) — moving average; window cut short at the ends", text: "movavg(|, 2, 2)" },
  { label: "movmedian / movrms / movsum / movsd(A, back, fwd)", text: "movmedian(|, 2, 2)" },
  { label: "movslope(A, back, fwd) — slope of A against x over the window", text: "movslope(|, 2, 2)" },
  { label: "emovavg(A, n) — exponential average, alpha = 2/(n+1)", text: "emovavg(|, 5)" },
  { label: "movmax / movmin(A, back, fwd) — window cut short at the ends, as movavg; plain numbers", text: "movmax(|, 2, 2)" },
  { label: "savgol(A, window, order) — Savitzky-Golay smooth; odd window, order < window, no blanks; ends repeat the edge value (Origin's Repeat); rows equally spaced", text: "savgol(|, 5, 2)" },
  { label: "cummax / cummin / cumprod(A) — running max / min / product down to this row; a blank cell stays blank", text: "cummax(|)" },
  { label: "correl(A, B) — correlation of two columns", text: "correl(|, B)" },
  { label: "cov(A, B) — sample covariance", text: "cov(|, B)" },
  { label: "slope(X, Y) — least-squares slope (X first, as Origin)", text: "slope(|, B)" },
  { label: "intercept(X, Y) — least-squares intercept (X first)", text: "intercept(|, B)" },
  { label: "percentile(A, p) — p from 0 to 100", text: "percentile(|, 50)" },
  { label: "skew(A) / kurt(A) — sample skewness / excess kurtosis", text: "skew(|)" },
  { label: "geomean(A) / harmean(A) — values must be above 0", text: "geomean(|)" },
  { label: "mad(A) — median absolute deviation", text: "mad(|)" },
  { label: "mode(A) — most frequent value (blank if none repeats)", text: "mode(|)" },
  { label: 'sumif(range, ">5", sumrange) — sum where the condition holds', text: 'sumif(|, ">5", B)' },
  { label: 'countif(range, ">=2") — conditions: > >= < <= = <>', text: 'countif(|, ">=2")' },
  { label: 'averageif(range, "<>0", avgrange)', text: 'averageif(|, "<>0", B)' },
  { label: 'maxifs / minifs(maxrange, range, ">5", …)', text: 'maxifs(|, B, ">5")' },
];
