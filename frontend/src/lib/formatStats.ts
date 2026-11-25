// The lazy-only half of lib/format.ts (bundle diet, plans/BUNDLE_HEADROOM.md
// slice 34): the integer-count formatter and the stat-key dispatch over it.
// Only the lazy Inspector, worksheet footer and workshop tables call them, so
// the code moved here verbatim and lib/format.ts re-exports it with
// `export *` - importers and tests are unchanged, and Rollup bundles this file
// with the lazy chunks that use it. architecture.test.ts ("re-exported lazy
// half") keeps eager modules off it.

import { fmtNum } from "./format";

/** Integer-valued quantities (N, point counts, row counts, iterations, bins):
 *  always the plain integer, never routed through the sig-figs / notation
 *  prefs (Scientific + 3 sf must not turn 201 into "2.01e+2"). No thousands
 *  grouping, matching the rest of the app. A non-integer value is NOT a count,
 *  so it falls back to fmtNum rather than being silently rounded. Non-numbers
 *  / non-finite → an em-dash, as fmtNum. */
export function fmtCount(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (!Number.isInteger(v)) return fmtNum(v);
  return v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
}

/** Stat keys (descriptive-stats routes, worksheet footer) that hold counts. */
export const COUNT_STAT_KEYS: ReadonlySet<string> = new Set(["N", "n", "count", "missing"]);

/** fmtCount for a count-valued stat key, fmtNum otherwise. */
export function fmtStat(key: string, v: unknown): string {
  return COUNT_STAT_KEYS.has(key) ? fmtCount(v) : fmtNum(v);
}
