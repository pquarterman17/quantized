// The worksheet grid's one numeric cell formatter, extracted from GridRow so
// the double-click autofit (MAIN_PLAN #3) samples EXACTLY the strings the
// grid renders — a width estimated from differently-formatted text would
// mis-fit. Kept out of lib/gridwindow (pure geometry) on purpose: this is a
// display concern of the worksheet subtree.

/** Render one numeric cell: em-dash for missing/non-finite, exponential for
 *  very large/small magnitudes, fixed otherwise — 4 decimals, or more below
 *  0.1 so a value keeps the 4 significant figures the exponential form shows
 *  (an emu moment of -0.00136 reads "-0.001361", not "-0.0014"). */
export function fmtCell(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e4 || (a < 1e-3 && v !== 0)) return v.toExponential(3);
  return v.toFixed(a > 0 && a < 0.1 ? 3 - Math.floor(Math.log10(a)) : 4);
}
