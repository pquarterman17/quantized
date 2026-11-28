// Shared "By" partitioning hook (JMP_GAP_PLAN J7) — the state half of the
// optional By-column select the Distribution and Fit Y by X workshops both
// offer: pick a categorical column, get back one ByLevel per level of the
// data the caller passes in. One implementation, two consumers (useDistribution
// / useFitYByX) so the picker, the reset-on-dataset-switch behavior, and the
// partition math never drift between the two workshops.
//
// Guard #11: the caller is responsible for passing the dataset's ANALYSIS
// view (lib/rowstate.analysisData), not a Dataset's raw `.data` — this hook
// has no dataset/store access of its own, so exclusions/filters are already
// baked into whatever `data` it's handed.
//
// Render-only: this never touches the shared row selection (lib/rowstate) —
// By is a display grouping, not a selection, so picking one can't fight the
// worksheet's singleton row-selection model (unlike, say, histogram bar
// brushing, which deliberately does write that selection).

import { useEffect, useMemo, useRef, useState } from "react";

import { type ByColumnOption, type ByLevel, byColumnOptions, partitionByColumn } from "../../lib/byPartition";
import { withTextGroupChannels, withTextGroupData } from "../../lib/groupableColumns";
import type { Dataset, DataStruct } from "../../lib/types";
import { useFollowColumnPicks } from "./useFollowColumnPicks";

// Re-exported so the two workshop hooks (useDistribution/useFitYByX) have a
// single import site for both the hook and its types.
export type { ByColumnOption, ByLevel };

export interface ByPartitionState {
  /** Categorical columns eligible as a By column (excludes x/time). */
  byOptions: ByColumnOption[];
  /** null = no By column selected (single, un-partitioned analysis). */
  byCol: number | null;
  setByCol: (i: number | null) => void;
  /** One entry per level of `byCol`, ascending, capped at
   *  lib/byPartition.BY_MAX_LEVELS; [] when `byCol` is null. */
  levels: ByLevel[];
  /** Uncapped level count of `byCol` — when it exceeds `levels.length`,
   *  the UI must say the partition was truncated (no silent caps). */
  totalLevels: number;
}

/** `columns` is the same `{index, label}[]` list the calling workshop
 *  already builds for its own column pickers (x/time at -1, channels at
 *  0..) — passed in rather than derived here so this hook stays free of any
 *  "how does a workshop name its x column" opinion. */
export function useByPartition(
  active: Dataset | null,
  data: DataStruct | null,
  columns: readonly ByColumnOption[],
  initialByCol: number | null = null,
): ByPartitionState {
  const [byCol, setByCol] = useState<number | null>(null);

  // The sheet's CSV text columns are By candidates too (lib/groupableColumns: appended after the real
  // channels, the same index the Stat stage and #1237's pickers use). A caller that already passes the
  // grouped sheet keeps its own list (it may have dropped a text column it is using as X/Y).
  const grouped = useMemo(() => (active ? withTextGroupChannels(active) : null), [active]);
  const groupedData = useMemo(() => (data ? withTextGroupData(data) : null), [data]);
  const allColumns = useMemo(() => {
    if (!active || !grouped || grouped === active) return columns;
    // Offered only while the rows being partitioned carry the column under that label: never a
    // pick that would partition by a column the data does not have.
    const text = grouped.data.labels.map((label, index) => ({ index, label }))
      .filter((c) => c.index >= active.data.labels.length && (!groupedData || groupedData.labels[c.index] === c.label));
    return [...columns, ...text];
  }, [active, grouped, groupedData, columns]);
  const byOptions = useMemo(() => byColumnOptions(grouped, allColumns), [grouped, allColumns]);

  // A dataset switch invalidates any By column picked on the previous one —
  // mirrors useDistribution's brush-reset-on-dataset-switch convention
  // rather than silently partitioning by a column index that may not even
  // exist (or means something else) on the newly active dataset.
  const seenId = useRef(active?.id);
  useEffect(() => {
    const sameSheet = seenId.current === active?.id;
    seenId.current = active?.id;
    // A text-column pick has no key in an analysis selection (Curve fit records `factorKeys` only for a
    // real channel), so the selection going back to "no factor" must not clear it.
    setByCol((now) => sameSheet && initialByCol === null && now !== null && active !== null && grouped !== active && now >= active.data.labels.length
      ? now
      : byOptions.some((option) => option.index === initialByCol) ? initialByCol : null);
  }, [active?.id, initialByCol]); // eslint-disable-line react-hooks/exhaustive-deps
  // A column added/removed under the pick follows it by label (./useFollowColumnPicks).
  useFollowColumnPicks(grouped, (follow) => {
    const next = byCol === null ? null : follow(byCol);
    if (next !== byCol) setByCol(next);
  });

  const partition = useMemo(() => {
    if (!groupedData || byCol == null) return { levels: [], totalLevels: 0 };
    return partitionByColumn(groupedData, byCol);
  }, [groupedData, byCol]);

  return { byOptions, byCol, setByCol, levels: partition.levels, totalLevels: partition.totalLevels };
}
