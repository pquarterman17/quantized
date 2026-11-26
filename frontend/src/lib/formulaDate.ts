// Date/time functions for the worksheet formula language (gap audit 9, G16).
// Part of the LAZY formula chunk (lib/formulaRefs.ts registers `DATE_FUNCS`
// in its plain function table and calls `tryParseDateCall`). A datetime is
// epoch seconds UTC — what a `time_is_datetime` column holds — so every
// function here is numeric in, numeric out; text <-> datetime conversion is
// `parse_date` / `format_date` in lib/formulaText.ts. The calendar math and
// the JMP/Origin naming notes are lib/formulaCalendar.ts.
//
//   year(t) month(t) day(t) hour(t) minute(t) second(t)   calendar fields
//   weekday(t)      1 = Sunday … 7 = Saturday (JMP Day Of Week, Origin weekday)
//   dayofyear(t)    1 = 1 January (JMP Day Of Year)
//   make_date(y, m, d [, hh, mi, ss])   epoch seconds (JMP Date DMY / Datetime)
//   datediff(a, b, "unit")   b - a in second|minute|hour|day|week (fractional)
//                           or month|year (whole completed, JMP "Actual");
//                           the unit is written in quotes, checked when the
//                           formula is entered
//
// A missing (NaN) input, a value outside years 1..9999 or a date that does
// not exist (30 Feb, month 13) is a MISSING result, never an error and never
// a rolled-over date. second() keeps the fraction (12:00:30.5 -> 30.5).

import { dateDiff, fieldsOf, makeEpoch, type Fields } from "./formulaCalendar";
import { DATE_EXTRA_FUNCS, parseDatedif } from "./formulaDateExtras";
import type { FormulaFn } from "./formulaTypes";
import type { ParserOps } from "./formulaRowFns";

const field = (pick: (f: Fields) => number) => (t: number): number => {
  const f = fieldsOf(t);
  return f ? pick(f) : NaN;
};

export const DATE_FUNCS: Record<string, (...a: number[]) => number> = {
  year: field((f) => f.y),
  month: field((f) => f.m),
  day: field((f) => f.d),
  hour: field((f) => f.hour),
  minute: field((f) => f.minute),
  second: field((f) => f.second),
  weekday: field((f) => f.weekday),
  dayofyear: field((f) => f.dayOfYear),
  make_date: (y, m, d, hh = 0, mi = 0, ss = 0) => makeEpoch(y, m, d, hh, mi, ss),
  ...DATE_EXTRA_FUNCS, // weeknum, quarter (lib/formulaDateExtras.ts)
};

const UNITS = ["second", "minute", "hour", "day", "week", "month", "year"];

/** `datediff(a, b, "unit")` after `datediff(` was eaten, or undefined. */
export function tryParseDateCall(fname: string, ops: ParserOps): FormulaFn | undefined {
  if (fname === "datedif") return parseDatedif(ops); // lib/formulaDateExtras.ts
  if (fname !== "datediff") return undefined;
  const a = ops.parseExpr();
  ops.expectOp(",");
  const b = ops.parseExpr();
  ops.expectOp(",");
  const u = ops.eat();
  if (u?.t !== "str") throw new Error(`datediff() takes its unit in quotes: ${UNITS.map((n) => `"${n}"`).join(", ")}`);
  const unit = u.v.trim().toLowerCase().replace(/s$/, "");
  if (!UNITS.includes(unit)) throw new Error(`datediff(): unknown unit "${u.v}" — use ${UNITS.join(", ")}`);
  ops.expectOp(")");
  return (c, ex) => dateDiff(a(c, ex), b(c, ex), unit);
}
