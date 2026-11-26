// Date extras for the worksheet formula language (plan item 28, element-wise
// half): datedif, weeknum, quarter, monthname, weekdayname. LAZY chunk, beside
// lib/formulaDate.ts (which registers the numeric ones and parses datedif) and
// lib/formulaText.ts (which routes the two name functions here because they
// return TEXT, legal only inside a text consumer — see its header).
//
// A date here is epoch seconds UTC, like every date function in this language
// (Origin's are Julian dates; the signatures below are Origin's with that
// substitution). A blank, non-finite or out-of-years-1..9999 input gives a
// missing result. All app-only: the headless export refuses them (the names
// are not in the plain function table, and the text ones are text).
//
//   datedif(d1, d2, "D"|"M"|"Y")   WHOLE completed days / months / years from d1
//                    to d2, truncated toward zero (Origin DateDif; the spelled
//                    "day" "month" "year" work too). Month and year counts are
//                    datediff's calendar rule (lib/formulaCalendar.ts dateDiff).
//   weeknum(d [, n1, n2])   n1 = 1 weeks start Sunday (default), 2 Monday;
//                    n2 = 0 or 1 week 1 is the week containing 1 January
//                    (default; Origin's example weeknum(1/11/2009) = 3), 2 week 1
//                    is the first week with at least 4 days in the new year
//                    (ISO 8601 when n1 = 2), and days before it belong to the
//                    previous year's last week. Result 1..53 (a Sunday-start,
//                    1-January week can also reach 54 in some years, as Excel).
//                    Measured in Origin 2026b over COM, 2026-11-25: n2 = 0 and 1
//                    are identical; formulaDateExtras.test.ts holds the table.
//   quarter(d)       1..4
//   monthname(d [, n])  English; n = 3 three letters (default, "Dec"), 0 full
//                    ("December"), 1 one letter ("D"), -1 three letters
//                    regardless of language (here the same as 3)
//   weekdayname(d [, n1 [, n2]])  n1 = 3 "Thu" (default), 0 "Thursday", 1 "T",
//                    -1 "THU". n2 is accepted and ignored (Origin: it does not
//                    change the name of a date).
// Any other name option (2, 4, 0.5 ...) gives the EMPTY text, as Origin does
// (measured in Origin 2026b, 2026-11-25); a blank date gives a missing result.
// Any other weeknum n1 / n2 gives a missing result, never a guess.

import { SECONDS_PER_DAY, civilFromDays, dateDiff, daysFromCivil, fieldsOf } from "./formulaCalendar";
import type { FormulaFn, FormulaRowContext } from "./formulaTypes";
import type { ParserOps } from "./formulaRowFns";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** `weeknum(d, n1, n2)`: see the header. */
export function weekNum(t: number, n1 = 1, n2 = 0): number {
  const f = fieldsOf(t);
  if (!f || !(n1 === 1 || n1 === 2) || !(n2 === 0 || n2 === 1 || n2 === 2)) return NaN;
  const days = Math.floor(t / SECONDS_PER_DAY);
  const sinceStart = (days: number): number => (((days + 4 + 8 - n1) % 7) + 7) % 7; // days since the week start; n1 1 = Sunday, 2 = Monday // 1970-01-01 was a Thursday (4 from Sunday)
  if (n2 < 2) {
    const jan1 = daysFromCivil(f.y, 1, 1);
    return Math.floor((days - jan1 + sinceStart(jan1)) / 7) + 1;
  }
  const mid = days + 3 - sinceStart(days); // the 4th day of the week decides which year owns it
  const y = civilFromDays(mid).y;
  return Math.floor((mid - daysFromCivil(y, 1, 1)) / 7) + 1;
}

export const quarter = (t: number): number => ((f) => (f ? Math.ceil(f.m / 3) : NaN))(fieldsOf(t));

export const DATE_EXTRA_FUNCS: Record<string, (...a: number[]) => number> = {
  weeknum: weekNum,
  quarter,
};

/** `datedif(` eaten: `d1, d2, "D"|"M"|"Y")`. */
export function parseDatedif(ops: ParserOps): FormulaFn {
  const a = ops.parseExpr();
  ops.expectOp(",");
  const b = ops.parseExpr();
  ops.expectOp(",");
  const u = ops.eat();
  if (u?.t !== "str") throw new Error('datedif() takes its unit in quotes: "D", "M" or "Y"');
  const unit = ({ d: "day", day: "day", days: "day", m: "month", month: "month", months: "month", y: "year", year: "year", years: "year" } as Record<string, string>)[u.v.trim().toLowerCase()];
  if (!unit) throw new Error(`datedif(): unknown unit "${u.v}" — use "D", "M" or "Y"`);
  ops.expectOp(")");
  return (c, ex) => ((n) => (unit === "day" ? Math.trunc(n) : n))(dateDiff(a(c, ex), b(c, ex), unit));
}

type TextFn = (c: Record<string, number>, ex: FormulaRowContext | undefined) => string | null;

/** `monthname(` / `weekdayname(` eaten: `d [, n])` as a text value. */
export function parseDateName(fname: string, ops: ParserOps): TextFn {
  const t = ops.parseExpr();
  let n: FormulaFn | undefined;
  const next = ops.peek();
  if (next?.t === "op" && next.v === ",") {
    ops.eat();
    n = ops.parseExpr();
  }
  if (fname === "weekdayname" && ops.peek()?.t === "op" && (ops.peek() as { v: string }).v === ",") {
    ops.eat();
    ops.parseExpr(); // n2: accepted, no effect on the name of a date
  }
  ops.expectOp(")");
  const month = fname === "monthname";
  return (c, ex) => {
    const f = fieldsOf(t(c, ex));
    const style = n ? n(c, ex) : 3;
    if (!f) return null;
    const full = month ? MONTHS[f.m - 1] : DAYS[f.weekday - 1];
    switch (style) {
      case 0:
        return full;
      case 1:
        return full[0];
      case 3:
        return full.slice(0, 3);
      case -1:
        return month ? full.slice(0, 3) : full.slice(0, 3).toUpperCase();
      default:
        return ""; // Origin: an invalid option gives empty text
    }
  };
}
