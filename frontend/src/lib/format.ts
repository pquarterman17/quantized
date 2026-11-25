// Shared numeric formatting for the inspector / workshops. JetBrains Mono
// renders these; keep them compact and unambiguous. Precision + notation are
// configurable via the Preferences dialog (Numbers tab) through setFormatOpts;
// the defaults below reproduce the original fixed behaviour (6 sig figs, auto
// scientific for very large/small magnitudes) so nothing changes until a user
// adjusts the pref.

export type Notation = "auto" | "scientific" | "fixed";

/** All formatter state in one object so the lazy `lib/locale` can
 *  drive it (thresholds `l` (low) / `u` (up) for Auto notation: 1e-3 and 1e5 are the
 *  original fixed values; `sf` / `n` the Numbers prefs; `s` (subscribers; replaced by a copy on
 *  every change, so it doubles as the snapshot) re-render display surfaces; `h` the display hooks). Eager code stays tiny on purpose. */
export const fmtCfg = {
  sf: 6, n: "auto" as Notation, l: 1e-3, u: 1e5,
  s: new Set<() => void>(),
  h: {} as FormatHooks,
};

/** Display-only hooks, registered by the lazy `lib/locale` (the
 *  locale half of the Numbers prefs). Unset = today's output, byte for byte.
 *  `num` re-punctuates a finished number string (decimal separator, digit
 *  grouping); `tick` does the same for an axis label (given its value);
 *  `int` and `when` replace a bare `toLocaleString()` on a count / a date.
 *  They are reached ONLY through fmtDisp / fmtDispStat, fmtInt and fmtWhen,
 *  never through fmtNum, which feeds saved result text. */
export interface FormatHooks {
  num?: (s: string) => string;
  tick?: (s: string, v?: number) => string;
  int?: (n: number, loc?: string) => string;
  when?: (d: Date, k?: string) => string;
  /** Worksheet cells: wraps a column's formatter (given lazily) for the Numbers prefs. */
  cell?: (own: () => (v: number | undefined) => string) => (v: number | undefined) => string;
}

/** Apply the Numbers preferences (called by the store on load + on change). */
export function setFormatOpts(sigFigs: number, notation: Notation): void {
  fmtCfg.sf = Math.min(12, Math.max(1, Math.round(sigFigs)));
  fmtCfg.n = notation;
}

/** Compact display of a possibly-non-numeric value, honouring the current
 *  sig-figs + notation prefs. Non-numbers / non-finite → an em-dash. */
export function fmtNum(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (fmtCfg.n === "scientific") return v.toExponential(fmtCfg.sf - 1);
  if (fmtCfg.n === "fixed") return v.toFixed(Math.min(fmtCfg.sf, 20));
  // auto: scientific only for very large / small magnitudes, else trimmed sig figs.
  const a = Math.abs(v);
  if (a !== 0 && (a < fmtCfg.l || a >= fmtCfg.u)) return v.toExponential(fmtCfg.sf - 1);
  return String(Number(v.toPrecision(fmtCfg.sf)));
}
