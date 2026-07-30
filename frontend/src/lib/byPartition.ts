// By-column partitioning (JMP_GAP_PLAN J7) — pure row-partition indices for
// an optional grouping ("By") column, shared by the Distribution and Fit Y by
// X workshops (JMP runs any analysis platform once per level of a By column;
// this is the row-partitioning half of that). Reuses lib/datasetsplit.ts's
// EXACT-VALUE grouping algorithm (a By column is always categorical — no
// gap-clustering dispatch needed, unlike datasetsplit's continuous/
// categorical split) WITHOUT MINTING DATASETS: this only returns row indices
// into the DataStruct the caller passes in, plus a convenience per-level
// sliced DataStruct (lib/datasetsplit.sliceDataStruct, itself dataset-minting
// -free — a plain object) so each workshop can feed its existing single-
// column analysis code unchanged, once per level.
//
// Guard #11: callers MUST pass the dataset's ANALYSIS view
// (lib/rowstate.analysisData), never a Dataset's raw `.data` — exclusions
// and the local filter have to apply BEFORE partitioning, exactly like every
// other analysis in this codebase. This module has no opinion on that; it
// only partitions whatever DataStruct it's given.
//
// Level labels use the same resolution the stat stage / Tabulate use
// (lib/barlayout.categoryLevels/resolveCategoryLabels) so a By section's
// header always matches what a plot or Tabulate row would call that level.

import { categoryLevels, resolveCategoryLabels } from "./barlayout";
import { columnValues, sliceDataStruct } from "./datasetsplit";
import { channelModelingType, isCategorical } from "./modeling";
import type { Dataset, DataStruct } from "./types";

/** A selectable column, in the `-1 = x, 0.. = channel` convention shared by
 *  every workshop's own column list (Tabulate's `TabulateColumn`, Fit Y by
 *  X's `FitYByXColumn`, Distribution's `DistributionColumn`, …). */
export interface ByColumnOption {
  index: number;
  label: string;
}

/** One level of a By-column partition. `rowIndexes` index into the SOURCE
 *  `data` passed to `partitionByColumn` (the caller's analysis view);
 *  `data` is that level's own sliced DataStruct (rows only — labels/units/
 *  metadata carried through unchanged) ready to feed straight into the same
 *  per-column analysis code the un-partitioned path already uses. */
export interface ByLevel {
  label: string;
  value: number;
  rowIndexes: number[];
  data: DataStruct;
}

/** Cap on partition levels. Auto-inference bounds nominal columns to 8
 *  levels (lib/modeling.NOMINAL_MAX_LEVELS), but a manual per-channel
 *  override (ChannelsCard) can mark ANY column nominal — including a
 *  near-unique run-ID column — and every level fans out 2-4 HTTP requests
 *  plus a rendered section in the consuming workshops. Cap here (the one
 *  chokepoint both workshops partition through) and report `totalLevels`
 *  so the UI can say what was dropped rather than truncating silently. */
export const BY_MAX_LEVELS = 30;

/** `levels` is capped at `maxLevels` (ascending order, so the FIRST N
 *  levels); `totalLevels` is the uncapped count for honest truncation UI. */
export interface ByPartitionResult {
  levels: ByLevel[];
  totalLevels: number;
}

/** Candidate By columns from a caller-supplied column list (typically the
 *  same `{index, label}[]` a workshop already builds for its own pickers):
 *  categorical (nominal/ordinal) value channels only, mirroring every other
 *  categorical-column picker in the app (Tabulate's group wells, the stat
 *  stage). The x/time column (`index === -1`) is never offered — it's
 *  always continuous (`lib/datasetsplit.isCategoricalColumn`'s rule). */
export function byColumnOptions(
  active: Dataset | null,
  columns: readonly ByColumnOption[],
): ByColumnOption[] {
  if (!active) return [];
  return columns.filter((c) => c.index >= 0 && isCategorical(channelModelingType(active, c.index)));
}

/** Partition `data`'s rows by `col`'s levels (ascending — the same order
 *  Tabulate/the bar chart use), exact-value grouping, no tolerance, no
 *  dataset minting. Non-finite `col` values drop out of every level (they
 *  already drop out of `categoryLevels`), the same convention the stat
 *  stage and Tabulate use for a categorical grouping column. At most
 *  `maxLevels` levels are materialized (see BY_MAX_LEVELS). */
export function partitionByColumn(
  data: DataStruct,
  col: number,
  maxLevels: number = BY_MAX_LEVELS,
): ByPartitionResult {
  const allLevels = categoryLevels(data, col);
  const totalLevels = allLevels.length;
  const levels = allLevels.slice(0, maxLevels);
  const labels = resolveCategoryLabels(data, col, levels);
  const by = columnValues(data, col);
  return {
    totalLevels,
    levels: levels.map((lvl, i) => {
      const rowIndexes: number[] = [];
      for (let r = 0; r < by.length; r++) if (by[r] === lvl) rowIndexes.push(r);
      return { label: labels[i], value: lvl, rowIndexes, data: sliceDataStruct(data, rowIndexes) };
    }),
  };
}
