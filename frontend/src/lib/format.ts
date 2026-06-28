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
