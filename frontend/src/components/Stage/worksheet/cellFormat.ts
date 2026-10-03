// The worksheet grid's numeric cell formatter, extracted from GridRow so
// the double-click autofit (MAIN_PLAN #3) samples EXACTLY the strings the
// grid renders — a width estimated from differently-formatted text would
// mis-fit. Kept out of lib/gridwindow (pure geometry) on purpose: this is a
// display concern of the worksheet subtree.

/** fmtCell's exponential threshold, and the largest magnitude shown in full. */
const BIG = 1e4;
const FULL = 1e15;
const MAX_DIGITS = 15;

export type CellFormatter = (v: number | undefined) => string;

/** Render one numeric cell: em-dash for missing/non-finite, exponential for
 *  very large/small magnitudes, fixed otherwise — 4 decimals, or more below
 *  0.1 so a value keeps the 4 significant figures the exponential form shows
 *  (an emu moment of -0.00136 reads "-0.001361", not "-0.0014"). */
export function fmtCell(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= BIG || (a < 1e-3 && v !== 0)) return v.toExponential(3);
  return v.toFixed(a > 0 && a < 0.1 ? 3 - Math.floor(Math.log10(a)) : 4);
}

/** Fewest decimals (from `from`, at most `cap`) at which `a` and `b` differ. */
function splitDecimals(a: number, b: number, from: number, cap: number): number {
  let d = Math.max(from, Math.min(cap, -Math.floor(Math.log10(Math.abs(a - b)))));
  while (d > from && a.toFixed(d - 1) !== b.toFixed(d - 1)) d--;
  while (d < cap && a.toFixed(d) === b.toFixed(d)) d++;
  return d;
}

const isLarge = (v: number | undefined): v is number =>
  v != null && Number.isFinite(v) && Math.abs(v) >= BIG && Math.abs(v) < FULL;

/** One column's formatter (`at(r)` reads row r of `n`, in data order). It is
 *  fmtCell unless the column's large values (|v| >= 1e4, exponential there)
 *  need more: in an all-integer column every value prints in full; otherwise,
 *  when two adjacent distinct large values print the same, the large values
 *  print fixed with the fewest decimals that tell every such pair apart (at
 *  most 15 significant digits). Values from 1e15 up stay exponential. Two
 *  O(n) passes; build it once per data change, never per cell. */
export function columnFormatter(n: number, at: (r: number) => number | undefined): CellFormatter {
  let allInt = true;
  let maxLarge = 0;
  for (let r = 0; r < n; r++) {
    const v = at(r);
    if (v == null || !Number.isFinite(v)) continue;
    if (allInt && !Number.isInteger(v)) allInt = false;
    if (isLarge(v) && Math.abs(v) > maxLarge) maxLarge = Math.abs(v);
  }
  if (maxLarge === 0) return fmtCell;
  if (allInt) return (v) => (v != null && Number.isFinite(v) && Math.abs(v) < FULL ? v.toFixed(0) : fmtCell(v));

  const cap = Math.max(0, MAX_DIGITS - (Math.floor(Math.log10(maxLarge)) + 1));
  let decimals = -1; // -1: no adjacent large values collide
  let prev: number | undefined;
  for (let r = 0; r < n && decimals < cap; r++) {
    const v = at(r);
    if (v == null || !Number.isFinite(v)) continue;
    const gap = prev === undefined ? 0 : Math.abs(v - prev);
    // Collide only below ~1e-3 relative (4 significant figures), and stay
    // apart once the gap is at least one unit of the current decimals.
    if (prev !== undefined && gap > 0 && isLarge(v) && isLarge(prev) && gap <= 2e-3 * Math.abs(v) &&
        (decimals < 0 ? fmtCell(v) === fmtCell(prev) : gap < 10 ** -decimals)) {
      decimals = splitDecimals(prev, v, Math.max(0, decimals), cap);
    }
    prev = v;
  }
  if (decimals < 0) return fmtCell;
  return (v) => (isLarge(v) ? v.toFixed(decimals) : fmtCell(v));
}

/** Lazily-built, cached formatters for a grid's columns (-1 = the x column):
 *  each column is scanned the first time it is drawn. Rebuild it when the
 *  data changes (the store replaces `time`/`values` on every edit). */
export function gridFormatters(time: number[], values: number[][]): (col: number) => CellFormatter {
  const cache = new Map<number, CellFormatter>();
  return (col) => {
    let f = cache.get(col);
    if (!f) {
      f = col < 0 ? columnFormatter(time.length, (r) => time[r]) : columnFormatter(values.length, (r) => values[r]?.[col]);
      cache.set(col, f);
    }
    return f;
  };
}
