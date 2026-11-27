// A timestamp column (epoch seconds, UTC) whose every finite value is midnight
// reads as plain dates: no "00:00" in axis ticks or cells. The server's
// `calc/axis_dates.is_date_only` and the CSV export use the same rule (pinned
// by tests/fixtures/wire/date_only_x.json); the column does not record
// whether it was read from date-only text, so one time of day makes it all
// date + time.
export function isDateOnly(xs: Iterable<number | null | undefined>): boolean {
  let any = false;
  for (const v of xs) {
    if (!Number.isFinite(v)) continue;
    if ((v as number) % 86400) return false;
    any = true;
  }
  return any;
}
