// Pure UTC calendar arithmetic behind the date/time formula functions (gap
// audit 9, G16; lib/formulaDate.ts, lib/formulaText.ts). A datetime in a
// worksheet is EPOCH SECONDS, UTC (what `metadata.time_is_datetime` columns
// hold: components/Stage/worksheet/cellFormat.ts fmtDateCell reads `v * 1000`).
// Everything here is integer day arithmetic (Howard Hinnant's public-domain
// days_from_civil / civil_from_days, https://howardhinnant.github.io/date_algorithms.html),
// not `Date`, so there is no timezone, no DST, no year-0..99 quirk and the
// proleptic Gregorian calendar holds for every year 1..9999. A value that is
// not a real instant is NaN / null, never an exception.
//
// Names and meanings follow JMP's Date-Time functions (Scripting Guide,
// https://www.jmp.com/support/help/en/18.2/jmp/date-time-functions.shtml):
// Day Of Week 1 = Sunday; Date Difference's "Actual" alignment counts WHOLE
// intervals (the month/year behaviour here); "Fractional" counts fractional
// ones (second..week here). Origin's weekday()/date functions
// (https://www.originlab.com/doc/LabTalk/ref/Weekday-func) number the week the
// same way (unverified: owner to check).

export const SECONDS_PER_DAY = 86400;
const LIMIT = 253402300800; // 10000-01-01T00:00:00Z: years 1..9999 only

/** Days since 1970-01-01 of a proleptic-Gregorian civil date. */
export function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z: number): { y: number; m: number; d: number } {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** The calendar fields of epoch seconds `t`, or null when `t` is not a
 *  finite instant inside years 1..9999. `second` keeps its fraction. */
export interface Fields {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Sunday … 7 = Saturday (JMP Day Of Week). */
  weekday: number;
  /** 1 = 1 January (JMP Day Of Year). */
  dayOfYear: number;
}

export function fieldsOf(t: number): Fields | null {
  if (!Number.isFinite(t) || t < -62135596800 || t >= LIMIT) return null;
  const days = Math.floor(t / SECONDS_PER_DAY);
  const sod = t - days * SECONDS_PER_DAY; // [0, 86400)
  const { y, m, d } = civilFromDays(days);
  const hour = Math.floor(sod / 3600);
  const minute = Math.floor((sod - hour * 3600) / 60);
  return {
    y,
    m,
    d,
    hour,
    minute,
    second: sod - hour * 3600 - minute * 60,
    weekday: ((((days + 4) % 7) + 7) % 7) + 1, // 1970-01-01 was a Thursday (5)
    dayOfYear: days - daysFromCivil(y, 1, 1) + 1,
  };
}

/** Epoch seconds of a civil date-time, or NaN when any part is not real
 *  (month 13, 30 February, hour 24, a fractional day …). Never rolls over. */
export function makeEpoch(y: number, m: number, d: number, hh = 0, mi = 0, ss = 0): number {
  const whole = [y, m, d, hh, mi].every(Number.isInteger);
  if (!whole || !Number.isFinite(ss) || y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return NaN;
  if (hh < 0 || hh > 23 || mi < 0 || mi > 59 || ss < 0 || ss >= 60) return NaN;
  return daysFromCivil(y, m, d) * SECONDS_PER_DAY + hh * 3600 + mi * 60 + ss;
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/** Parse an ISO 8601 date or date-time (`2026-03-01`, `2026-03-01T12:30`,
 *  `2026-03-01 12:30:45.5`, optional `Z` / `+05:30` offset; no offset = UTC)
 *  to epoch seconds, or NaN. Surrounding spaces are ignored. A date with an
 *  offset but no time, week dates, ordinal dates and a 60th second are NaN. */
export function parseIsoDate(s: string): number {
  const m = ISO.exec(s.trim());
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [hh, mi, ss] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  const frac = m[7] ? Number(`0.${m[7]}`) : 0;
  const base = makeEpoch(y, mo, d, hh, mi, ss);
  if (Number.isNaN(base)) return NaN;
  let offset = 0;
  if (m[8] && m[8].toUpperCase() !== "Z") {
    const digits = m[8].slice(1).replace(":", "");
    const [oh, om] = [Number(digits.slice(0, 2)), Number(digits.slice(2) || 0)];
    if (oh > 23 || om > 59) return NaN;
    offset = (m[8][0] === "-" ? -1 : 1) * (oh * 3600 + om * 60);
  }
  return base + frac - offset;
}

const p2 = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD HH:MM:SS` (fraction dropped), or null for a non-instant. */
export function formatIso(t: number): string | null {
  const f = fieldsOf(t);
  if (!f) return null;
  return `${String(f.y).padStart(4, "0")}-${p2(f.m)}-${p2(f.d)} ${p2(f.hour)}:${p2(f.minute)}:${p2(Math.floor(f.second))}`;
}

export const DIFF_UNITS: Readonly<Record<string, number>> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 };
export const CALENDAR_UNITS: ReadonlySet<string> = new Set(["month", "year"]);

/** `b - a` in `unit`. second/minute/hour/day/week: exact fractional elapsed
 *  time (JMP "Fractional"). month/year: WHOLE completed calendar months/years
 *  from a to b, truncated toward zero (JMP "Actual"): the largest n with
 *  a + n months <= b, where adding months keeps the time of day and CLAMPS the
 *  day to the month's end — the count dateutil.relativedelta gives. So 31 Jan
 *  -> 28 Feb is 1 month, 29 Feb 2024 -> 28 Feb 2025 is 1 year, and 15 Mar ->
 *  15 Jan 09:00 (earlier, not yet two months back) is -1. NaN when either end
 *  is not an instant. */
export function dateDiff(a: number, b: number, unit: string): number {
  const fa = fieldsOf(a);
  const fb = fieldsOf(b);
  if (!fa || !fb) return NaN;
  const size = DIFF_UNITS[unit];
  if (size !== undefined) return (b - a) / size;
  const sod = a - Math.floor(a / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  const plus = (n: number): number => {
    const idx = fa.y * 12 + (fa.m - 1) + n;
    const [y, m] = [Math.floor(idx / 12), (idx % 12) + 1];
    return daysFromCivil(y, m, Math.min(fa.d, daysInMonth(y, m))) * SECONDS_PER_DAY + sod;
  };
  let months = (fb.y - fa.y) * 12 + (fb.m - fa.m);
  if (b >= a && months > 0 && plus(months) > b) months--;
  else if (b < a && months < 0 && plus(months) < b) months++;
  return unit === "month" ? months : Math.trunc(months / 12);
}
