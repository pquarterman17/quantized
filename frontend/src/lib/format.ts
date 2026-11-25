// Shared numeric formatting for the inspector / workshops. JetBrains Mono
// renders these; keep them compact and unambiguous. Precision + notation are
// configurable via the Preferences dialog (Numbers tab) through setFormatOpts;
// the defaults below reproduce the original fixed behaviour (6 sig figs, auto
// scientific for very large/small magnitudes) so nothing changes until a user
// adjusts the pref.

export type Notation = "auto" | "scientific" | "fixed";

let _sigFigs = 6;
let _notation: Notation = "auto";

/** Apply the Numbers preferences (called by the store on load + on change). */
export function setFormatOpts(sigFigs: number, notation: Notation): void {
  _sigFigs = Math.min(12, Math.max(1, Math.round(sigFigs)));
  _notation = notation;
}

/** Compact display of a possibly-non-numeric value, honouring the current
 *  sig-figs + notation prefs. Non-numbers / non-finite → an em-dash. */
export function fmtNum(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (_notation === "scientific") return v.toExponential(_sigFigs - 1);
  if (_notation === "fixed") return v.toFixed(Math.min(_sigFigs, 20));
  // auto: scientific only for very large / small magnitudes, else trimmed sig figs.
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(_sigFigs - 1);
  return String(Number(v.toPrecision(_sigFigs)));
}

/** Integer-valued quantities (N, point counts, row counts, iterations, bins):
 *  always the plain integer, never routed through the sig-figs / notation
 *  prefs (Scientific + 3 sf must not turn 201 into "2.01e+2"). No thousands
 *  grouping, matching the rest of the app. A non-integer value is NOT a count,
 *  so it falls back to fmtNum rather than being silently rounded. Non-numbers
 *  / non-finite → an em-dash, as fmtNum. */
export function fmtCount(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (!Number.isInteger(v)) return fmtNum(v);
  return v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
}

/** Stat keys (descriptive-stats routes, worksheet footer) that hold counts. */
export const COUNT_STAT_KEYS: ReadonlySet<string> = new Set(["N", "n", "count", "missing"]);

/** fmtCount for a count-valued stat key, fmtNum otherwise. */
export function fmtStat(key: string, v: unknown): string {
  return COUNT_STAT_KEYS.has(key) ? fmtCount(v) : fmtNum(v);
}
