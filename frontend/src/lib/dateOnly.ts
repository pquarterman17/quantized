// A timestamp column (epoch seconds, UTC) whose every finite value is midnight
// reads as plain dates: no "00:00" in axis ticks or cells. The server's
// `calc/axis_dates.is_date_only` and the CSV export use the same rule (pinned
// by tests/fixtures/wire/date_only_x.json); the column does not record
// whether it was read from date-only text, so one time of day makes it all
// date + time.
export function isDateOnly(xs: ArrayLike<number | null | undefined>): boolean {
  let n = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v % 86400 !== 0) return false;
    n++;
  }
  return n > 0;
}
