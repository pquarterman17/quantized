// Replace an analysis output IN PLACE (store/analysisOutputReplace.ts): the new
// result may order, add or drop columns, and everything bound to the old
// worksheet by column INDEX (plots, figures, graph curves, sheet() formulas,
// analysis results) must follow by column NAME or the replace is refused.
// Pure: labels in, a plan out, no store import.
//
// The plan is a SEQUENCE of the one-column shifts `lib/channelRemap.ts` already
// knows (removed, moved, inserted), so the store applies the very same remap
// every column delete / insert / move uses (store/columnRemovalRefs.ts) instead
// of a second implementation of it:
//   1. drop every old column with no unambiguous name match (highest first),
//   2. move the survivors into the new order,
//   3. insert the new columns that have no old counterpart (lowest first).
// A BOUND column that cannot be matched by a unique name is never dropped
// silently: the plan fails closed and names it.

import { type ColumnShift, remapChannel } from "./channelRemap";

export interface ColumnProblem {
  col: number;
  label: string;
  /** removed: the name is gone from the new output; duplicate: it is not unique in the old or the new one. */
  kind: "removed" | "duplicate";
}

export type ColumnPlan =
  | { ok: true; shifts: ColumnShift[]; map: (c: number) => number | null }
  | { ok: false; problems: ColumnProblem[] };

const count = (labels: readonly string[], label: string): number => labels.filter((l) => l === label).length;

/** The old -> new index of every old column matched by a UNIQUE name (null: unmatched). */
export function matchColumnsByName(oldLabels: readonly string[], newLabels: readonly string[]): (number | null)[] {
  return oldLabels.map((label) =>
    count(oldLabels, label) === 1 && count(newLabels, label) === 1 ? newLabels.indexOf(label) : null);
}

/** One index map out of a shift sequence (null: the column was dropped). */
export function composeShifts(shifts: readonly ColumnShift[]): (c: number) => number | null {
  return (c) => {
    let at: number | null = c;
    for (const shift of shifts) {
      if (at === null) return null;
      at = remapChannel(at, shift);
    }
    return at;
  };
}

/** The shifts turning `oldLabels` into `newLabels` by name, or the bound
 *  columns (`bound`: old indexes something uses) that cannot follow. */
export function planColumnMapByName(
  oldLabels: readonly string[],
  newLabels: readonly string[],
  bound: ReadonlySet<number>,
): ColumnPlan {
  const target = matchColumnsByName(oldLabels, newLabels);
  const problems: ColumnProblem[] = [];
  for (const col of [...bound].sort((a, b) => a - b)) {
    const label = oldLabels[col];
    if (label === undefined) {
      problems.push({ col, label: `#${col + 1}`, kind: "removed" });
    } else if (target[col] === null) {
      problems.push({ col, label, kind: newLabels.includes(label) ? "duplicate" : "removed" });
    }
  }
  if (problems.length) return { ok: false, problems };

  const shifts: ColumnShift[] = [];
  // 1. unmatched old columns, highest first so the lower indexes stay valid
  for (let c = oldLabels.length - 1; c >= 0; c--) if (target[c] === null) shifts.push(c);
  // 2. survivors (in old order) moved into new order: slot p takes the p-th smallest target
  const order = target.flatMap((t) => (t === null ? [] : [t]));
  const sorted = [...order].sort((a, b) => a - b);
  for (let p = 0; p < sorted.length; p++) {
    const q = order.indexOf(sorted[p]!);
    if (q === p) continue;
    shifts.push({ from: q, to: p });
    order.splice(p, 0, ...order.splice(q, 1));
  }
  // 3. new columns nobody matched, lowest first
  const taken = new Set(sorted);
  for (let j = 0; j < newLabels.length; j++) if (!taken.has(j)) shifts.push({ inserted: j });
  return { ok: true, shifts, map: composeShifts(shifts) };
}
