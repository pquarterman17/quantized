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

import { useEffect, useMemo, useState } from "react";

import { type ByColumnOption, type ByLevel, byColumnOptions, partitionByColumn } from "../../lib/byPartition";
import type { Dataset, DataStruct } from "../../lib/types";

// Re-exported so the two workshop hooks (useDistribution/useFitYByX) have a
// single import site for both the hook and its types.
export type { ByColumnOption, ByLevel };

export interface ByPartitionState {
  /** Categorical columns eligible as a By column (excludes x/time). */
  byOptions: ByColumnOption[];
  /** null = no By column selected (single, un-partitioned analysis). */
  byCol: number | null;
  setByCol: (i: number | null) => void;
  /** One entry per level of `byCol`, ascending; [] when `byCol` is null. */
  levels: ByLevel[];
}

/** `columns` is the same `{index, label}[]` list the calling workshop
 *  already builds for its own column pickers (x/time at -1, channels at
 *  0..) — passed in rather than derived here so this hook stays free of any
 *  "how does a workshop name its x column" opinion. */
export function useByPartition(
  active: Dataset | null,
  data: DataStruct | null,
  columns: readonly ByColumnOption[],
): ByPartitionState {
  const [byCol, setByCol] = useState<number | null>(null);

  // A dataset switch invalidates any By column picked on the previous one —
  // mirrors useDistribution's brush-reset-on-dataset-switch convention
  // rather than silently partitioning by a column index that may not even
  // exist (or means something else) on the newly active dataset.
  useEffect(() => {
    setByCol(null);
  }, [active?.id]);

  const byOptions = useMemo(() => byColumnOptions(active, columns), [active, columns]);

  const levels = useMemo(() => {
    if (!data || byCol == null) return [];
    return partitionByColumn(data, byCol);
  }, [data, byCol]);

  return { byOptions, byCol, setByCol, levels };
}
