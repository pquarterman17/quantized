// P1.4 categorical accessors (PRIMARY_SOFTWARE_AUDIT_PLAN): the ONLY
// sanctioned read path for `DataStruct.catLevels`. A categorical column IS a
// numeric channel (float codes 0..n-1, NaN = missing) PLUS a first-class
// ordered level table -- see the backend's `quantized.datastruct` module
// docstring for the full CATEGORICAL CONTRACT (representation, lossless +
// invertible guarantee, JMP-parity ruling). Every consumer (barlayout,
// modeling, plotspec, …) goes through these three functions rather than
// indexing `ds.catLevels` directly, so a future storage-scheme change is a
// one-module edit. Mirrors the backend's `is_categorical`/`level_labels`/
// `level_of` in `quantized/datastruct.py` — keep the two in sync by hand.

import type { DataStruct } from "./types";

/** Is `channel` a categorical channel (has a level table)? */
export function isCategoricalChannel(ds: DataStruct, channel: number): boolean {
  const levels = ds.catLevels;
  return !!levels && Object.prototype.hasOwnProperty.call(levels, channel);
}

/** The ordered level strings for `channel`, or `null` when it isn't
 *  categorical. Order IS the levels' code order (`levels[code]`). */
export function categoricalLevels(ds: DataStruct, channel: number): string[] | null {
  const levels = ds.catLevels;
  if (!levels) return null;
  const list = levels[channel];
  return list ? list : null;
}

/** The level string for one numeric `code` (a cell value from
 *  `ds.values`), or `null` for a non-categorical channel, a non-finite code
 *  (NaN = missing), a non-integer code, or an out-of-range one -- never
 *  throws, so a caller can pass a raw cell value with no pre-check. */
export function levelLabel(ds: DataStruct, channel: number, code: number): string | null {
  const levels = categoricalLevels(ds, channel);
  if (!levels || !Number.isFinite(code) || !Number.isInteger(code)) return null;
  return code >= 0 && code < levels.length ? levels[code] : null;
}

/** Display label for one group-column level value (P4-4, `lib/plotspec.ts`
 *  `buildXY` / `calc.plotting.build_grouped_series`'s frontend counterpart):
 *  the channel's string level when it's categorical, else the level's raw
 *  numeric value coerced the same way a `${level}` template literal would
 *  (JS `Number.prototype.toString`). Grouping EQUALITY is unaffected either
 *  way — this only resolves what gets RENDERED in the series label. */
export function groupLevelLabel(ds: DataStruct, channel: number, level: number): string {
  return isCategoricalChannel(ds, channel) ? (levelLabel(ds, channel, level) ?? String(level)) : String(level);
}
