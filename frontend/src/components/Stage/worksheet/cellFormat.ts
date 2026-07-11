// The worksheet grid's one numeric cell formatter, extracted from GridRow so
// the double-click autofit (MAIN_PLAN #3) samples EXACTLY the strings the
// grid renders — a width estimated from differently-formatted text would
// mis-fit. Kept out of lib/gridwindow (pure geometry) on purpose: this is a
// display concern of the worksheet subtree.

/** Render one numeric cell: em-dash for missing/non-finite, exponential for
 *  very large/small magnitudes, fixed 4-decimal otherwise. */
export function fmtCell(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(4);
}
