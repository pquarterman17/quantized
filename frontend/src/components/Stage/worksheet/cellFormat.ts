// The worksheet grid's numeric cell formatter, extracted from GridRow so
// the double-click autofit (MAIN_PLAN #3) samples EXACTLY the strings the
// grid renders — a width estimated from differently-formatted text would
// mis-fit. Kept out of lib/gridwindow (pure geometry) on purpose: this is a
// display concern of the worksheet subtree.

import { formatNumber } from "../../../lib/columnProps";
import { isDateOnly } from "../../../lib/dateOnly";
import { fmtCfg } from "../../../lib/format";
export { useFormatEpoch } from "../../../lib/useFormatEpoch";
import { clockCell } from "../../../lib/importTimeFormats";
import type { ColumnProps } from "../../../lib/columnProps";

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

/** fmtCell's notations, each for a whole column (UX audit 8 #8: one column
 *  read "1.553e-5" above "0.001591" when fmtCell chose per cell). */
const expCell: CellFormatter = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toExponential(3));
const fixedCell: CellFormatter = (v) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const d = a > 0 && a < 0.1 ? 3 - Math.floor(Math.log10(a)) : 4;
  return d > 20 ? v.toExponential(3) : v.toFixed(d); // never zeros where the value lives past 20 places
};

/** One column's formatter (`at(r)` reads row r of `n`, in data order), with
 *  ONE notation for the whole column, picked from its magnitude range:
 *  exponential when it reaches 1e4, or when it stays below 1 with values
 *  under 1e-3 (a VSM moment column); otherwise fixed, with fmtCell's
 *  significant figures. The column's large values (|v| >= 1e4) may need
 *  more: in an all-integer column every value prints in full; otherwise,
 *  when two adjacent distinct large values print the same, the large values
 *  print fixed with the fewest decimals that tell every such pair apart (at
 *  most 15 significant digits), and the rest of the column fixed too.
 *  Values from 1e15 up stay exponential. Two O(n) passes; build it once per data change, never per cell. */
export function columnFormatter(n: number, at: (r: number) => number | undefined): CellFormatter {
  let allInt = true;
  let maxLarge = 0, maxAbs = 0, minNonZero = Infinity;
  for (let r = 0; r < n; r++) {
    const v = at(r);
    if (v == null || !Number.isFinite(v)) continue;
    if (allInt && !Number.isInteger(v)) allInt = false;
    const a = Math.abs(v);
    if (isLarge(v) && a > maxLarge) maxLarge = a;
    if (a > maxAbs) maxAbs = a;
    if (a > 0 && a < minNonZero) minNonZero = a;
  }
  // Also exponential when fixed would need more than ~12 decimals for the
  // smallest value, or the column spans more than 9 decades ([5, 3e-25]).
  const wide = minNonZero < 1e-9 || maxAbs / minNonZero > 1e9;
  const plain = maxAbs >= BIG || (maxAbs < 1 && minNonZero < 1e-3) || wide ? expCell : fixedCell;
  if (maxLarge === 0) return plain;
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
  if (decimals < 0) return plain;
  return (v) => (isLarge(v) ? v.toFixed(decimals) : fixedCell(v));
}

/** A timestamp cell (epoch seconds, UTC -- the importers' convention) as
 *  `YYYY-MM-DD HH:MM:SS`, the date column Origin shows (worksheet audit #7);
 *  fractional seconds only when present. Em-dash for missing/out of range. */
export function fmtDateCell(v: number | undefined): string {
  if (v == null || !Number.isFinite(v) || Math.abs(v) > 8.64e12) return "—";
  const iso = new Date(v * 1000).toISOString(); // 2026-03-01T12:00:00.000Z
  const ms = iso.slice(19, 23);
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}${ms === ".000" ? "" : ms}`;
}

/** A date-only timestamp cell (`lib/dateOnly`): `YYYY-MM-DD`. */
export function fmtDayCell(v: number | undefined): string {
  return fmtDateCell(v).slice(0, 10);
}

/** A time-of-day X cell (`metadata.time_is_clock`): the stored seconds since
 *  midnight shown as `HH:MM:SS` (milliseconds when present), wrapping every
 *  24 h. Display only -- the stored value stays seconds. */
export function fmtClockCell(v: number | undefined): string {
  return clockCell(v) || "—";
}

/** Lazily-built, cached formatters for a grid's columns (-1 = the x column):
 *  each column is scanned the first time it is drawn. Rebuild it when the
 *  data changes (the store replaces `time`/`values` on every edit). A column
 *  with a user display format (`Dataset.columnProps`, Origin's Column
 *  Properties › Display) uses that instead — no scan. `xIsDate`: the x column holds
 *  timestamps (`metadata.time_is_datetime`) and shows dates.
 *
 *  Numbers prefs (display only; the stored values and every export are
 *  untouched): the lazy `fmtCfg.h.cell` hook (lib/locale.ts) may swap
 *  a numeric column's formatter for the Inspector's `fmtNum` ("Worksheet cells
 *  follow ...") and re-punctuate it (decimal separator, grouping). Built when
 *  the grid builds its formatters, so rebuild on `useFormatEpoch`. */
export function gridFormatters(
  time: number[],
  values: number[][],
  props?: Record<number, ColumnProps>,
  xIsDate: boolean | "clock" = false,
): (col: number) => CellFormatter {
  const cache = new Map<number, CellFormatter>();
  return (col) => {
    let f = cache.get(col);
    const user = props?.[col]?.format;
    if (!f && user) f = (v) => formatNumber(v, user);
    if (!f) {
      const own = () => (col < 0 ? columnFormatter(time.length, (r) => time[r]) : columnFormatter(values.length, (r) => values[r]?.[col]));
      f = col < 0 && xIsDate === "clock" ? fmtClockCell : col < 0 && xIsDate ? (isDateOnly(time) ? fmtDayCell : fmtDateCell) : fmtCfg.h.cell?.(own) || own();
      cache.set(col, f);
    }
    return f;
  };
}
