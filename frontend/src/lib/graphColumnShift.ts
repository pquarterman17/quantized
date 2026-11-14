// The seam a source's column edit uses to reach the live graphs plotting it
// (gap audit 2 #1): a column insert/delete/move (store/columnRemovalRefs.ts's
// chokepoint) and a re-import that changed the columns (store/reimport.ts).
// The remaps themselves (lib/linkedCurveColumns.ts) are lazy:
// store/linkedCurvesSync.ts registers them when installed, which happens
// whenever a graph is created or loaded -- with no graph in the workspace this
// stays null and costs nothing. Same registered-extension shape as
// lib/formulaExt.ts.

import type { ColumnShift } from "./channelRemap";
import type { Dataset } from "./types";

export interface GraphColumnSeam {
  shift(datasets: readonly Dataset[], id: string, shift: ColumnShift): Dataset[] | null;
  relabel(datasets: readonly Dataset[], id: string, oldLabels: readonly string[], newLabels: readonly string[]): Dataset[] | null;
}
let registered: GraphColumnSeam | null = null;

export const graphColumnSeam = (): GraphColumnSeam | null => registered;

export function registerGraphColumnSeam(seam: GraphColumnSeam): void {
  registered = seam;
}
