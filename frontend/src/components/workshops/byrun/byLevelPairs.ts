// The finite (x, y) of one By level for the plotted channel pair: the Y's OWN X
// (secondary-X sheets), gap rows dropped. Shared by the single-curve tools'
// By sections so every one reads a level exactly the way Curve Fit's By does.

import { dropGapRows } from "../../../lib/api/finitePairs";
import { ownXKey } from "../../../lib/perSeriesX";
import type { Dataset, DataStruct } from "../../../lib/types";
import type { ByColumnOption } from "../useByPartition";

export function levelPairs(
  active: Dataset,
  level: DataStruct,
  xKey: number | null,
  yKey: number,
): { x: number[]; y: number[] } {
  const fitX = ownXKey(active, xKey, yKey);
  const xs = fitX == null ? level.time : level.values.map((row) => row[fitX]!);
  const ys = level.values.map((row) => row[yKey]!);
  const { x, y } = dropGapRows(xs, ys);
  return { x, y };
}

/** Grouping candidates: every column except the plotted X and Y. */
export function byCandidates(active: Dataset | null, xKey: number | null, yKey: number | null): ByColumnOption[] {
  if (!active) return [];
  const own = yKey == null ? xKey : ownXKey(active, xKey, yKey);
  return active.data.labels
    .map((label, index) => ({ index, label }))
    .filter((c) => c.index !== own && c.index !== yKey);
}
