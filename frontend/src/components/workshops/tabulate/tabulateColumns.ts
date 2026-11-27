// Tabulate workshop: pure column helpers (split out of useTabulate.ts to keep
// that hook under its size ceiling): a column's values, the default group and
// value picks, and the reorder used by the wells.

import { channelModelingType, isCategorical } from "../../../lib/modeling";
import type { DataStruct, Dataset } from "../../../lib/types";

export const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

/** First channel that reads as categorical (nominal/ordinal), or null. */
export function firstCategorical(active: Dataset | null): number | null {
  if (!active) return null;
  for (let i = 0; i < active.data.labels.length; i++) {
    if (isCategorical(channelModelingType(active, i))) return i;
  }
  return null;
}

/** First continuous channel that isn't in `avoid`, or the first free channel,
 *  or 0. */
export function firstContinuous(active: Dataset | null, avoid: readonly number[]): number {
  if (!active) return 0;
  const n = active.data.labels.length;
  const skip = new Set(avoid);
  for (let i = 0; i < n; i++) {
    if (!skip.has(i) && !isCategorical(channelModelingType(active, i))) return i;
  }
  for (let i = 0; i < n; i++) if (!skip.has(i)) return i;
  return 0;
}

export function moveInArray<T>(arr: readonly T[], item: T, direction: -1 | 1): T[] {
  const i = arr.indexOf(item);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= arr.length) return [...arr];
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
