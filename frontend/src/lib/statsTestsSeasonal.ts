// Statistical-tests workshop — the seasonal Mann-Kendall trend test (Origin
// feature-gap item 8): catalog entry, the pure request builder and the restore
// of its two settings. The settings ride in the rows-family params (`rowt`:
// `seasonFrom`, `period`) so no new top-level params key exists.
//
// Time is the X column (or the picked time column), the values are the second
// pick, and the season is either a column of season labels (months 1-12, quarter
// numbers, ...) or a PERIOD P: the season is then the time index modulo P, which
// must be whole numbers. Rows where time, value or season is missing are dropped.

import type { BuildOutcome, TestDef, TestParams, TestSelection } from "./statsTests";
import { columnDisplayName } from "./statschooser";
import type { DataStruct } from "./types";

export type SeasonFrom = "column" | "period";
export const SEASON_FROM: readonly { id: SeasonFrom; label: string }[] = [
  { id: "column", label: "A column of season labels" },
  { id: "period", label: "A period (season = time index mod P)" },
];
export const MAX_PERIOD = 1000;
export const DEFAULT_SEASONAL = { seasonFrom: "column" as SeasonFrom, period: 12 };

export const SEASONAL_TEST: TestDef = {
  id: "seasonal-mann-kendall", family: "Correlation", label: "Seasonal Mann-Kendall trend", input: "rowwise",
  blurb: "Is there a monotonic trend within each season (month, quarter, ...), so a seasonal cycle cannot pass for a trend, and how steep is it? Time, values, and a season column or period.",
};

/** The worksheet columns the test reads, builder order. */
export const seasonalColumns = (sel: TestSelection, seasonFrom: SeasonFrom): number[] =>
  [sel.x, sel.y, ...(seasonFrom === "column" ? [sel.byCol] : [])];

const col = (data: DataStruct, i: number): number[] => (i < 0 ? data.time : data.values.map((r) => r[i]));

export function buildSeasonal(data: DataStruct, sel: TestSelection, p: TestParams): BuildOutcome {
  const { seasonFrom, period } = p.rowt;
  const fail = (error: string): BuildOutcome => ({ ok: false, error });
  if (sel.x === sel.y) return fail("Pick two different columns: time and the values.");
  if (seasonFrom === "column" && (sel.byCol === sel.x || sel.byCol === sel.y)) return fail("The season column must differ from the time and value columns.");
  if (seasonFrom === "period" && !(Number.isInteger(period) && period >= 2 && period <= MAX_PERIOD)) {
    return fail(`The period must be a whole number from 2 to ${MAX_PERIOD}.`);
  }
  const xs = col(data, sel.x);
  const ys = col(data, sel.y);
  const ss = seasonFrom === "column" ? col(data, sel.byCol) : null;
  const x: number[] = [];
  const y: number[] = [];
  const season: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i]) || (ss && !Number.isFinite(ss[i]))) continue;
    x.push(xs[i]); y.push(ys[i]);
    if (ss) season.push(ss[i]);
  }
  if (y.length < 4) return fail("The seasonal Mann-Kendall test needs at least 4 rows where time, value and season are all numbers.");
  const name = (c: number) => columnDisplayName(data, c);
  const body = { y, x, alpha: p.alpha, ...(ss ? { season } : { period }) };
  const labels = [name(sel.x), name(sel.y), ss ? name(sel.byCol) : `period ${period}`];
  return { ok: true, request: { id: "seasonal-mann-kendall", body }, labels };
}

/** The two settings from a saved `rowt` record (absent -> defaults; present but invalid -> null). */
export function restoreSeasonal(r: Record<string, unknown>): typeof DEFAULT_SEASONAL | null {
  const seasonFrom = r.seasonFrom === undefined ? DEFAULT_SEASONAL.seasonFrom : r.seasonFrom;
  const period = r.period === undefined ? DEFAULT_SEASONAL.period : r.period;
  if (!SEASON_FROM.some((s) => s.id === seasonFrom) || typeof period !== "number" || !Number.isInteger(period) || period < 2 || period > MAX_PERIOD) return null;
  return { seasonFrom: seasonFrom as SeasonFrom, period };
}
