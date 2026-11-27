// Statistical tests workshop — first column picks. Tests whose first slot is a
// time (Mann-Kendall's time or order; the survival and life-data tests' follow-up
// time) read it from the worksheet's X column when the file has one, because that
// is where a time axis lives; the second slot is then the first Y channel. The
// generic picks (first two continuous channels) would otherwise reverse them for a
// file with time in X and a single Y.

import type { StatsTestId } from "./api/statsTests";
import type { TestSelection } from "./statsTests";

export interface PickColumn {
  index: number;
  categorical: boolean;
}

const SURVIVAL_AND_LIFE: ReadonlySet<StatsTestId> = new Set(["kaplan-meier", "logrank", "cox-ph", "life-distribution", "life-by-x"]);

/** Does this test read a time in its first slot (so its first-pick default may differ)? */
export const timeFirst = (id: StatsTestId): boolean => id === "mann-kendall" || id === "seasonal-mann-kendall" || SURVIVAL_AND_LIFE.has(id);

/** Sensible first picks: continuous columns as data, categorical ones as factors. */
export function defaultSelection(columns: readonly PickColumn[], id?: StatsTestId): TestSelection {
  const cont = columns.filter((c) => !c.categorical && c.index >= 0).map((c) => c.index);
  const cat = columns.filter((c) => c.categorical).map((c) => c.index);
  let x = cont[0] ?? 0;
  let y = cont.find((c) => c !== x) ?? -1;
  // Mann-Kendall always reads time from X; survival / life only when the file has
  // a single Y channel (time in X, event or censor flag in Y), else both are Y.
  if (id && timeFirst(id) && columns.some((c) => c.index < 0) && (id === "mann-kendall" || id === "seasonal-mann-kendall" || cont.length <= 1)) {
    x = -1;
    y = cont[0] ?? -1;
  }
  return {
    x,
    y,
    cols: cont.slice(0, 2),
    byCol: cat[0] ?? 0,
    byCol2: cat[1] ?? cat[0] ?? 1,
    groupMode: cat.length > 0 ? "category" : "columns",
  };
}

/** The x/y picks to apply when the picked test changes: only when entering or
 *  leaving a time-first test, so a user's picks for the other tests stay put. */
export function pairOnTestChange(columns: readonly PickColumn[], from: StatsTestId, to: StatsTestId): Pick<TestSelection, "x" | "y"> | null {
  if (!timeFirst(from) && !timeFirst(to)) return null;
  const { x, y } = defaultSelection(columns, to);
  return { x, y };
}
