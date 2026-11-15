// A column-changing re-import of a source (store/reimport.ts) renumbers its
// columns. Live graphs' curves that read it (`Dataset.linkedCurves`) are
// re-pointed by column LABEL, never by index: a curve whose column vanished
// -- or whose label is ambiguous (repeated in the old or the fresh file) --
// is marked missing (-1) and drawn empty. It is never rebound to a different
// column (fail closed; the sibling of lib/channelRemap's
// remapLinkedCurveSources, which handles a removed column).
//
// Pure.

import type { Dataset } from "./types";

/** `datasets` with every graph curve reading `id` re-pointed from the
 *  `oldLabels` column order to the `newLabels` one; null when no graph reads it. */
export function remapLinkedCurvesByLabel(
  datasets: readonly Dataset[],
  id: string,
  oldLabels: readonly string[],
  newLabels: readonly string[],
): Dataset[] | null {
  const move = moveByLabel(oldLabels, newLabels);
  let changed = false;
  const next = datasets.map((d) => {
    if (!d.linkedCurves?.some((c) => c.datasetId === id)) return d;
    changed = true;
    return {
      ...d,
      linkedCurves: d.linkedCurves.map((c) =>
        c.datasetId !== id ? c : { ...c, yKey: move(c.yKey), xKey: c.xKey === null ? null : move(c.xKey) },
      ),
    };
  });
  return changed ? next : null;
}

/** The column move by LABEL from `oldLabels` to `newLabels`: a column that
 *  vanished, or whose label repeats in either list, is -1 (missing). Graph
 *  layers' inset curves follow a re-import by the same rule
 *  (lib/graphLayerRemap.ts, origin gap audit 3 #15). */
export function moveByLabel(oldLabels: readonly string[], newLabels: readonly string[]): (c: number) => number {
  const count = (list: readonly string[], l: string) => list.filter((x) => x === l).length;
  return (c) => {
    if (c < 0) return c;
    const label = oldLabels[c];
    if (label === undefined || count(oldLabels, label) !== 1 || count(newLabels, label) !== 1) return -1;
    return newLabels.indexOf(label);
  };
}
