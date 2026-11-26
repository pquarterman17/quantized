// Fill series over a worksheet selection (Origin gap plan item 29): the cells
// below (or to the right of) a start, or a start and a second value, become an
// arithmetic number series, or a date series stepping by day, week, month or
// year. Pure: the caller supplies the selection and a value reader and writes
// the returned edits as ONE `setCellBlock` (one undo step).
//
// RULES
// - Along each line (a column when filling down, a row when filling across)
//   the first cell is the start. A second, non-blank cell makes it a start and
//   a second value: the step is their difference, and fill begins at the third
//   cell. A blank second cell means a start alone, with step 1 (one unit for a
//   date). Cells after the seeds are overwritten.
// - Numbers: start + k·step, not repeated addition (no float drift).
// - Dates are epoch seconds (lib/formulaCalendar.ts). Day and week steps are
//   exact seconds. Month and year steps keep the start's day of month and time,
//   clamped to the month's length: Jan 31 + 1 month = Feb 28 (29 in a leap
//   year), and the clamp never carries on (Mar 31 follows, not Mar 28).
// - FAIL CLOSED, whole selection, nothing written: a text or computed column, a
//   date column in a number fill (and the reverse), a blank start, two dates
//   that are not a whole number of the unit apart, a date outside years 1..9999.

import type { CellEdit, PasteBounds } from "./clipboardGrid";
import { daysInMonth, fieldsOf, makeEpoch, SECONDS_PER_DAY } from "./formulaCalendar";

export type DateUnit = "day" | "week" | "month" | "year";
export type SeriesDirection = "down" | "across";

export interface SeriesRequest {
  /** Selected rows (original indices) in DISPLAY order. */
  rows: readonly number[];
  /** Selected columns; -1 is the X column. */
  cols: readonly number[];
  direction: SeriesDirection;
  /** Present: a date series stepping by this unit. Absent: a number series. */
  unit?: DateUnit;
  valueAt: (row: number, col: number) => number | null | undefined;
  bounds: PasteBounds;
  /** Does column `col` hold dates (epoch seconds)? */
  isDateCol: (col: number) => boolean;
  /** The column's name for messages. */
  colName: (col: number) => string;
}

export type SeriesResult = { edits: CellEdit[]; lines: number } | { problem: string };

/** `t` moved by `n` calendar months, the day of month clamped to the target
 *  month. NaN when the result is outside years 1..9999. */
export function addMonths(t: number, n: number): number {
  const f = fieldsOf(t);
  if (!f) return NaN;
  const total = f.y * 12 + (f.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  if (y < 1 || y > 9999) return NaN;
  return makeEpoch(y, m, Math.min(f.d, daysInMonth(y, m)), f.hour, f.minute, f.second);
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const UNIT_SECONDS = { day: SECONDS_PER_DAY, week: 7 * SECONDS_PER_DAY } as const;

/** The whole-unit step between two dates, or the reason there is none. */
function dateStep(unit: DateUnit, a: number, b: number): number | string {
  if (unit === "day" || unit === "week") {
    const n = (b - a) / UNIT_SECONDS[unit];
    return Number.isInteger(n) ? n : `the two dates are not a whole number of ${unit}s apart`;
  }
  const fa = fieldsOf(a);
  const fb = fieldsOf(b);
  if (!fa || !fb) return "a seed is not a valid date";
  const months = (fb.y - fa.y) * 12 + (fb.m - fa.m);
  const n = unit === "year" ? months / 12 : months;
  // Re-derive the second date from the first: a clamped month end (Jan 31 then Feb 28) still counts as one month.
  return Number.isInteger(n) && addMonths(a, months) === b ? n : `the two dates are not a whole number of ${unit}s apart`;
}

/** The value k steps from `start` for a date series. */
const dateAt = (unit: DateUnit, start: number, step: number, k: number): number =>
  unit === "day" || unit === "week" ? start + k * step * UNIT_SECONDS[unit] : addMonths(start, k * step * (unit === "year" ? 12 : 1));

export function seriesEdits(req: SeriesRequest): SeriesResult {
  const rows = [...new Set(req.rows)].filter((r) => r >= 0 && r < req.bounds.rows);
  const cols = [...new Set(req.cols)].sort((a, b) => a - b);
  const down = req.direction === "down";
  if ((down ? rows.length : cols.length) < 2 || rows.length === 0 || cols.length === 0) {
    return { problem: `select at least two cells ${down ? "in a column" : "in a row"} to fill ${down ? "down" : "across"}` };
  }
  for (const c of cols) {
    const name = req.colName(c);
    if (c < -1 || c >= req.bounds.writableCols) return { problem: `"${name}" is computed and can't be filled` };
    if (c >= 0 && req.bounds.levelsAt?.(c)) return { problem: `"${name}" is a text column and can't be filled with a series` };
    const date = req.isDateCol(c);
    if (req.unit && !date) return { problem: `"${name}" holds numbers: a date series needs the date column on its own` };
    if (!req.unit && date) return { problem: `"${name}" holds dates: choose a date series (by day, week, month or year)` };
  }
  const lines = down ? cols.map((c) => rows.map((r) => [r, c] as const)) : rows.map((r) => cols.map((c) => [r, c] as const));
  const edits: CellEdit[] = [];
  for (const line of lines) {
    const where = down ? `"${req.colName(line[0][1])}"` : `row ${line[0][0] + 1}`;
    const first = req.valueAt(...line[0]);
    if (!isNum(first)) return { problem: `the first cell of ${where} is blank: a series needs a start` };
    const second = req.valueAt(...line[1]);
    const seeded = isNum(second) ? 2 : 1;
    let step = 1;
    if (isNum(second)) {
      if (req.unit) {
        const s = dateStep(req.unit, first, second);
        if (typeof s === "string") return { problem: `${where}: ${s}` };
        step = s;
      } else step = second - first;
    }
    for (let k = seeded; k < line.length; k++) {
      const value = req.unit ? dateAt(req.unit, first, step, k) : first + k * step;
      if (!Number.isFinite(value) || (req.unit && fieldsOf(value) === null)) return { problem: `${where}: the series runs out of range at cell ${k + 1}` };
      edits.push({ row: line[k][0], col: line[k][1], value });
    }
  }
  if (edits.length === 0) return { problem: "nothing to fill: the selection holds only the start values" };
  return { edits, lines: lines.length };
}
