// Shared numeric formatting for the inspector / workshops. JetBrains Mono
// renders these; keep them compact and unambiguous.

/** Compact display of a possibly-non-numeric value: scientific for very
 *  large/small magnitudes, otherwise 6 significant figures with trailing
 *  zeros trimmed. Non-numbers / non-finite → an em-dash placeholder. */
export function fmtNum(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(4);
  return String(Number(v.toPrecision(6)));
}
