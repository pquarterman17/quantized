// P1.4 categorical accessors (PRIMARY_SOFTWARE_AUDIT_PLAN): the ONLY
// sanctioned read path for `DataStruct.cat_levels`. A categorical column IS a
// numeric channel (float codes 0..n-1, NaN = missing) PLUS a first-class
// ordered level table -- see the backend's `quantized.datastruct` module
// docstring for the full CATEGORICAL CONTRACT (representation, lossless +
// invertible guarantee, JMP-parity ruling). Every consumer (barlayout,
// modeling, plotspec, …) goes through these three functions rather than
// indexing `ds.cat_levels` directly, so a future storage-scheme change is a
// one-module edit. Mirrors the backend's `is_categorical`/`level_labels`/
// `level_of` in `quantized/datastruct.py` — keep the two in sync by hand.

import type { DataStruct } from "./types";

// ── Category LEVELS: which distinct values a column's categories are ────────
//
// JMP_GAP J1 (Group O-1). Five modules independently implemented "the distinct
// finite values of this column, ascending" — `lib/barlayout.ts`,
// `lib/plotspec.ts`'s `buildXY`, `lib/plotGroupSplit.ts` (twice: a list and a
// count), and the Data Filter workshop's `distinctLevels`. Same five lines
// each, and each one is the answer to "what are this column's levels?", so
// they must never be able to disagree — the BUG-008 lesson, where TWO copies of
// one decision gave two answers and silently merged three samples into one
// dataset. `architecture.test.ts` carries a chokepoint that keeps new copies
// out.
//
// They live HERE, not in `barlayout.ts` where the first copy was, because level
// ORDER is about to stop being "ascending by code": J1's user-settable ordering
// makes it a property of the categorical model, which is this module. Putting
// the primitive here now makes that a one-module change instead of a five-site
// one. `barlayout.ts` re-exports `categoryLevels` so its eight importers stay
// untouched by this refactor.
//
// NOT unified, deliberately: `lib/datasetsplit.ts`'s `autoTolerance` contains
// the identical five lines over the identical types, and is NOT this. It takes
// the distinct values of a CONTINUOUS column to measure the gaps between them
// for elbow detection. Those are not category levels, they are sample points on
// a measurement axis, and a user-settable level order must never reach them.
// A dedupe driven by shape rather than meaning would have swallowed it.
// `lib/tabulate.ts` is a third case: it orders composite multi-dimension row
// keys and never builds a distinct-level list, so it shares this convention
// without sharing the code.

/** A column's values by the `-1 = x/time, 0.. = a value channel` convention
 *  shared with `ColumnFilter.col` (lib/types.ts). Lives here rather than being
 *  imported so this module depends on nothing but `./types` — it sits at the
 *  bottom of the import graph, and `lib/datasetsplit.ts`'s identical
 *  `columnValues` is on the far side of a cycle through `barlayout.ts`.
 *  Exported because `barlayout.ts` had its own private copy of exactly this
 *  (`colValues`), and one convention implemented twice is what Group O-1 is
 *  about — the `-1` half especially, since forgetting it silently reads
 *  `row[-1]` as undefined for every row. */
export function columnOf(data: DataStruct, channel: number): readonly number[] {
  return channel < 0 ? data.time : data.values.map((row) => row[channel]);
}

/** The distinct finite values of `values`, ascending — a column's category
 *  LEVELS. Non-finite entries (NaN = a missing category, and null/undefined
 *  from an already-nulled plot payload) are dropped rather than becoming a
 *  level of their own, which is the convention every consumer relies on. `-0`
 *  and `0` collapse to one level, because a `Set` uses SameValueZero — and so
 *  does the `Map` keying in `lib/datasetsplit.ts`'s exact-value grouping, so
 *  the two agree on what counts as one level. */
export function levelsOf(values: readonly (number | null | undefined)[]): number[] {
  return [...new Set(values.filter((v): v is number => v != null && Number.isFinite(v)))].sort((a, b) => a - b);
}

/** How many levels `values` has, without materializing the sorted list — the
 *  same answer as `levelsOf(values).length`, which a test pins. Kept in the
 *  same one-statement shape as `levelsOf` on purpose: `architecture.test.ts`'s
 *  chokepoint recognises that shape, and a guard whose pattern no longer
 *  describes its own home protects nothing (its vacuity test caught exactly
 *  that on this module's first draft). */
export function levelCountOf(values: readonly (number | null | undefined)[]): number {
  return new Set(values.filter((v): v is number => v != null && Number.isFinite(v))).size;
}

/** `channel`'s category levels, ascending (`-1` reads the x/time column). The
 *  accessor every order-sensitive consumer goes through: bar/box/violin axis
 *  slots, the interactive categorical x-axis, group-split series order,
 *  Tabulate's group labels, the stat stage, facets, Fit Y by X, variability
 *  charts and JMP-style By partitioning. */
export function categoryLevels(data: DataStruct, channel: number): number[] {
  return levelsOf(columnOf(data, channel));
}

/** True when `v` is a genuine non-empty array of strings -- NOT just
 *  truthy. P1.4 review P2-3/P3-1: these accessors are "the ONLY sanctioned
 *  read path" (module doc above), so they must degrade safely even when
 *  called directly on a structurally corrupted `cat_levels` (e.g. `{0:
 *  "AB"}` from a hand-edited file, or any ingestion path that never went
 *  through `lib/workspace.ts`'s OWN .dwk-load sanitization). Without this
 *  check, a bare string like `"AB"` reads as truthy and JS happily indexes
 *  INTO it (`"AB"[0] === "A"`) -- silent, plausible-looking, WRONG output
 *  instead of a caught error. */
function isValidLevelList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string");
}

/** Is `channel` a categorical channel (has a well-formed level table)? */
export function isCategoricalChannel(ds: DataStruct, channel: number): boolean {
  const levels = ds.cat_levels;
  return !!levels && isValidLevelList(levels[channel]);
}

/** The ordered level strings for `channel`, or `null` when it isn't
 *  categorical (absent OR structurally malformed). Order IS the levels'
 *  code order (`levels[code]`). */
export function categoricalLevels(ds: DataStruct, channel: number): string[] | null {
  const levels = ds.cat_levels;
  if (!levels) return null;
  const list = levels[channel];
  return isValidLevelList(list) ? list : null;
}

/** Same resolution `levelLabel` does, against an already-fetched level array
 *  rather than a full DataStruct -- for a caller (the worksheet grid,
 *  GridRow's categorical cell display/edit, P1.6b) that already has the
 *  levels on hand and shouldn't reconstruct a lookup DataStruct just to call
 *  the channel-indexed accessor below. Same "never throws, degrades to
 *  null" contract. */
export function labelForCode(levels: readonly string[], code: number): string | null {
  if (!Number.isFinite(code) || !Number.isInteger(code)) return null;
  return code >= 0 && code < levels.length ? levels[code] : null;
}

/** The level string for one numeric `code` (a cell value from
 *  `ds.values`), or `null` for a non-categorical channel, a non-finite code
 *  (NaN = missing), a non-integer code, or an out-of-range one -- never
 *  throws, so a caller can pass a raw cell value with no pre-check. */
export function levelLabel(ds: DataStruct, channel: number, code: number): string | null {
  const levels = categoricalLevels(ds, channel);
  return levels ? labelForCode(levels, code) : null;
}

/** Structural repair of a possibly-corrupted DataStruct's `cat_levels` (P1.4
 *  review P2-3/P3-1): drop any entry whose level list isn't a non-empty
 *  array of strings (a hand-edited/corrupted .dwk, e.g. `{0: "AB"}` --
 *  `isValidLevelList` above is what actually protects the accessors, but a
 *  parsed DataStruct is sanitized once up front too, so it never even
 *  CARRIES a malformed entry into the store). Called by `lib/workspace.ts`'s
 *  `parseWorkspace` on every DataStruct that already passed its own
 *  structural check (time/values/labels/units/metadata) -- this only
 *  repairs `cat_levels`, never rejects the dataset. Returns the SAME object
 *  when there's nothing to repair (the common, non-categorical case) or a
 *  fresh one otherwise -- never mutates the input. */
export function sanitizeDataStruct(data: DataStruct): DataStruct {
  const raw = data.cat_levels;
  if (raw === undefined) return data;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    const { cat_levels: _drop, ...rest } = data;
    return rest as DataStruct;
  }
  const out: Record<number, string[]> = {};
  for (const [key, list] of Object.entries(raw)) {
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && isValidLevelList(list)) out[idx] = list;
  }
  const { cat_levels: _drop, ...rest } = data;
  return Object.keys(out).length ? { ...rest, cat_levels: out } : (rest as DataStruct);
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
