// Keep a workshop's column picks on THEIR columns when the active dataset's
// columns change under it (a removed or added formula, a column-changing
// reimport). The workshops' own effects re-derive their picks only when the
// dataset ID changes, so a removed column used to slide every later pick onto
// its neighbour with no notice (crossRefOpenGaps.test.ts). One shared rule:
// follow the pick's label to its new index; when that label is gone (or now
// ambiguous) the caller resets the pick and ONE short toast says so.

import { useEffect, useRef } from "react";

import type { Dataset } from "../../lib/types";
import { toast } from "../../store/toasts";

/** Where pick `col` belongs after the labels went `prev` -> `next`: its new
 *  index, or null when its column is gone. An in-place rename (same column
 *  count) keeps the index; the time axis (-1) never moves. */
export function followColumn(prev: readonly string[], next: readonly string[], col: number): number | null {
  const label = prev[col];
  if (col < 0 || label === undefined) return col;
  const unique = (labels: readonly string[]) => labels.indexOf(label) === labels.lastIndexOf(label);
  const at = next.indexOf(label);
  if (at >= 0 && unique(next) && unique(prev)) return at;
  return next.length === prev.length ? col : null;
}

/** Calls `apply(follow)` once each time `active`'s column labels change
 *  (same dataset id); `follow(col)` returns the pick's new index, or null —
 *  the caller then resets that pick, and one toast names the lost column. */
export function useFollowColumnPicks(
  active: Dataset | null | undefined,
  apply: (follow: (col: number) => number | null) => void,
): void {
  const seen = useRef(active);
  useEffect(() => {
    const prev = seen.current;
    seen.current = active;
    if (!prev || !active || prev.id !== active.id || prev.data.labels === active.data.labels) return;
    const before = prev.data.labels;
    const after = active.data.labels;
    let lost: string | undefined;
    apply((col) => {
      const next = followColumn(before, after, col);
      if (next === null) lost ??= before[col];
      return next;
    });
    if (lost !== undefined) toast(`Column "${lost}" is gone, so its pick was reset.`, "info");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply` is read fresh from this render
  }, [active]);
}
