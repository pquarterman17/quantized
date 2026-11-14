// A source's column insert/delete/move -- or a re-import that changed its
// columns -- carried onto the live graphs that plot it (gap audit 2 #1).
// store/columnRemovalRefs.ts and store/reimport.ts reach it through the seam
// in lib/graphColumnShift.ts, which the (lazy) sync registers.

import { remapChannel, type ColumnShift } from "./channelRemap";
import type { LinkedCurve } from "./linkedCurveTypes";
import type { Dataset } from "./types";

/** Follow a column insert/delete/move on `sourceId`: `remap` gives each old
 *  column's new index, or -1 when it was deleted -- then the curve is dead
 *  (a deleted X too: it is never re-pointed at another X). */
export function remapCurveColumns(
  curves: readonly LinkedCurve[],
  sourceId: string,
  remap: (col: number) => number,
): LinkedCurve[] {
  return curves.map((c) => {
    if (c.datasetId !== sourceId || c.yKey < 0) return c;
    const y = remap(c.yKey);
    const x = c.xKey === null ? null : remap(c.xKey);
    return { ...c, yKey: y < 0 || (x !== null && x < 0) ? -1 : y, xKey: x !== null && x < 0 ? null : x };
  });
}

/** Every graph plotting `id`, its curves re-pointed past `shift` (a curve on
 *  the removed column draws empty, never another column); null when no
 *  graph plots `id`. */
export function shiftGraphColumns(datasets: readonly Dataset[], id: string, shift: ColumnShift): Dataset[] | null {
  const hit = (d: Dataset) => d.linkedCurves?.some((c) => c.datasetId === id);
  if (!datasets.some(hit)) return null;
  return datasets.map((d) => (hit(d) ? { ...d, linkedCurves: remapCurveColumns(d.linkedCurves!, id, (c) => remapChannel(c, shift) ?? -1) } : d));
}

/** Re-find `sourceId`'s curves by column LABEL after its columns changed (a
 *  re-import, review finding 4). A label missing, or no longer unique, kills
 *  the curve rather than guessing. */
export function relabelCurveColumns(
  curves: readonly LinkedCurve[],
  sourceId: string,
  oldLabels: readonly string[],
  newLabels: readonly string[],
): LinkedCurve[] {
  const find = (col: number): number => {
    const label = oldLabels[col];
    const first = newLabels.indexOf(label);
    return label === undefined || first < 0 || newLabels.indexOf(label, first + 1) >= 0 ? -1 : first;
  };
  return remapCurveColumns(curves, sourceId, find);
}

/** Every graph plotting `id`, its curves re-found by label after a re-import
 *  changed `id`'s columns; null when no graph plots `id`. */
export function relabelGraphColumns(
  datasets: readonly Dataset[],
  id: string,
  oldLabels: readonly string[],
  newLabels: readonly string[],
): Dataset[] | null {
  const hit = (d: Dataset) => d.linkedCurves?.some((c) => c.datasetId === id);
  if (!datasets.some(hit)) return null;
  return datasets.map((d) => (hit(d) ? { ...d, linkedCurves: relabelCurveColumns(d.linkedCurves!, id, oldLabels, newLabels) } : d));
}
