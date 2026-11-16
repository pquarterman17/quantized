// The first plot of a freshly imported dataset (UX audit 8, lane UX8-A):
// which columns go on Y1 / Y2, and whether Y opens on a log scale. Run once
// at import / re-import (store/firstPlotNotice.ts's `withFirstPlot`, lazy),
// stored as `metadata.first_plot`, and read by store/windowDefaults.ts's
// `datasetViewDefaults` below technique memory. Never for an Origin book or
// a parser-flagged 2-D map, and never over a user's, a saved project's or an
// imported Origin graph's choice: those are explicit view fields, and the
// defaults only seed a fresh binding.
//
// Channels: a VSM export (Field / Moment / Temperature) used to plot Moment
// (1e-3 emu) and Temperature (300 K) on one axis, flattening the loop. Now:
// - a monitor column is never auto-plotted: a temperature against a
//   non-temperature X, a status/chamber/motor/setpoint column, a readback in
//   X's own unit, or a constant column. Against a time X (a logger: s, min,
//   hr, days, or a Time/Date/Elapsed label) nothing is a monitor;
// - Y1 is the unit group of the first remaining column; a second unit group
//   goes on Y2 only when it is a single column; the rest stay unplotted but
//   listed in Channels (one click away).
// A parser's `default_value_channels` hint, a categorical column, or columns
// that are ALL monitors leave the density default (`defaultDenseChannels`)
// unchanged. A table without units is one (blank) unit, so one group: only
// its monitor columns can be left off.
//
// Log Y: when every finite Y1 value is positive and they span more than
// three decades (XRR, R(T) through a transition). The import toast says so
// and offers "Linear Y" (store/firstPlotNotice.ts).
import { defaultDenseChannels } from "./plotdata";
import type { DataStruct } from "./types";

export interface FirstPlot {
  /** The Y set when columns were left off; null = the density default. */
  yKeys: number[] | null;
  y2Keys: number[] | null;
  /** Decades Y1 spans when it should open on log Y; 0 = stay linear. */
  logDecades: number;
}

const TEMP_UNIT = /^(m?K|°C|degC|℃)$/;
// Word starts only: "Sample Temp" and "T_temp" are temperatures, "Attempt"
// and "Template" are not. Pressure is NOT here: against T it is often the
// measurement (vapour pressure); a chamber gauge says "Chamber".
const MONITOR = /(^|[^a-z])(status|chamber|motor|set ?point)/i;
// A name that says it is a measured quantity is data, never a monitor via the
// pattern above: "Motor Current (A)", "Chamber Signal". (Constant and
// readback-in-X's-unit columns are still left off.)
const DATA_NAME = /current|voltage|resistance|moment|signal|intensity/i;
const isTemp = (label: string, unit: string): boolean => /(^|[^a-z])temp/i.test(label) || TEMP_UNIT.test(unit);
const TIME_UNIT = /^(s|secs?|ms|us|µs|min|mins|h|hrs?|hours?|days?)$/i;

/** A column whose finite values (≤ ~2000 strided rows) never move. */
function flat(ds: DataStruct, c: number): boolean {
  const step = Math.max(1, Math.floor(ds.values.length / 2000));
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r < ds.values.length; r += step) {
    const v = ds.values[r][c];
    if (Number.isFinite(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  }
  return hi >= lo && hi - lo <= 1e-6 * Math.max(Math.abs(lo), Math.abs(hi));
}

/** Decades `chs` span against a finite X when every value is positive, else 0.
 *  Measured from the 1st to 99th percentile of the values, so one outlier
 *  (a 1e4 spike among values of 1-3) cannot open log on its own. */
function logSpan(ds: DataStruct, xKey: number | null, chs: readonly number[]): number {
  const vals: number[] = [];
  for (let r = 0; r < ds.values.length; r++) {
    const row = ds.values[r];
    if (!Number.isFinite(xKey == null ? ds.time[r] : row[xKey])) continue;
    for (const c of chs) {
      const v = row[c];
      if (!Number.isFinite(v)) continue;
      if (v <= 0) return 0;
      vals.push(v);
    }
  }
  if (vals.length === 0) return 0;
  const sorted = Float64Array.from(vals).sort();
  const n = sorted.length - 1;
  const decades = Math.log10(sorted[Math.ceil(0.99 * n)] / sorted[Math.floor(0.01 * n)]);
  return decades > 3 ? Math.round(decades * 10) / 10 : 0;
}

/** The first plot of `ds` against `xKey`; `skip` = channels already hidden
 *  (error columns), kept in `yKeys` as they were and never grouped. */
export function firstPlot(ds: DataStruct, xKey: number | null, skip: readonly number[] = []): FirstPlot {
  const md = ds.metadata ?? {};
  const base = defaultDenseChannels(ds, xKey);
  const live = base.filter((c) => !skip.includes(c));
  let y1 = live;
  let y2: number[] = [];
  if (!Array.isArray(md["default_value_channels"]) && !live.some((c) => ds.cat_levels?.[c])) {
    const xLabel = xKey == null ? String(md["x_column_long"] || md["x_column_name"] || "") : ds.labels[xKey];
    const xUnit = (xKey == null ? String(md["x_column_unit"] ?? "") : (ds.units[xKey] ?? "")).trim();
    const timeX =
      (xKey == null && md["time_is_datetime"] === true) || TIME_UNIT.test(xUnit) || /^(time|date|elapsed)/i.test(xLabel);
    const unit = (c: number) => (ds.units[c] ?? "").trim();
    const monitor = (c: number) =>
      (isTemp(ds.labels[c], unit(c)) && !isTemp(xLabel, xUnit)) ||
      (MONITOR.test(ds.labels[c]) && !DATA_NAME.test(ds.labels[c])) ||
      (unit(c) !== "" && unit(c) === xUnit) ||
      flat(ds, c);
    const data = timeX ? live : live.filter((c) => !monitor(c));
    if (data.length > 0) {
      const key = (c: number) => unit(c).toLowerCase();
      y1 = data.filter((c) => key(c) === key(data[0]));
      const rest = data.filter((c) => key(c) !== key(data[0]));
      const g2 = rest.filter((c) => key(c) === key(rest[0]));
      if (g2.length === 1) y2 = g2;
    }
  }
  const shown = new Set([...y1, ...y2]);
  return {
    yKeys: live.every((c) => shown.has(c)) ? null : base.filter((c) => shown.has(c) || !live.includes(c)),
    y2Keys: y2.length > 0 ? y2 : null,
    logDecades: logSpan(ds, xKey, y1),
  };
}
