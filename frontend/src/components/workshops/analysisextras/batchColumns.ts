// Column roles for a batch over selected worksheets, for the tools that pick
// their own columns (surface fit, optical gap, ellipse fit). Each worksheet's
// reviewed roles (AnalysisSelectionItem: X, then the Y channels) become the
// tool's column picks, and its row / range selection is honoured, so a batch
// reads exactly what "Review inputs" shows -- never the active worksheet's
// picker indexes applied blindly to a differently laid-out sheet.

import { analysisSelectionData, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { finiteColumns, mapDefaults } from "./columnPicks";

/** The tool's picks (-1 = the X/time axis) for one reviewed worksheet.
 *  `channels` is how many Y channels the tool needs after X: 1 (optical gap,
 *  ellipse) or 2 (surface fit: Y then Z). Throws a message that says why not. */
export function batchPicks(dataset: Dataset, item: AnalysisSelectionItem, channels: 1 | 2): number[] {
  if (channels === 2) {
    // A parser-flagged 2-D map names its own axes and value channel.
    const map = mapDefaults(dataset);
    if (map) return map;
  }
  const ys = item.yKeys.filter((k) => k !== item.xKey);
  if (channels === 1) {
    if (ys.length === 0) throw new Error("No response column is selected.");
    return [item.xKey ?? -1, ys[0]!];
  }
  if (ys.length !== 2) {
    throw new Error(`Surface fit needs X plus exactly two selected columns (Y and Z); this worksheet has ${ys.length} selected.`);
  }
  return [item.xKey ?? -1, ys[0]!, ys[1]!];
}

/** The finite rows of the picked columns inside the item's row / range selection. */
export function batchColumns(dataset: Dataset, item: AnalysisSelectionItem, picks: readonly number[]): number[][] {
  return finiteColumns(analysisSelectionData(dataset, item), picks);
}
