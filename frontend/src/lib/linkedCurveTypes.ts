// A live graph's curve (gap audit 2 #1, lib/linkedCurves.ts) -- type only,
// so every module that names it (the dataset type, the workspace read/merge,
// the column seam) shares no runtime chunk for it. A curve whose source can
// never resolve (an unmapped .dwk merge) carries the empty source id "".

export interface LinkedCurve {
  datasetId: string;
  /** X column in the source; null = the Y column's own X. */
  xKey: number | null;
  /** Y column in the source; -1 = a curve that can never resolve (drawn empty). */
  yKey: number;
  /** The user's legend text; absent = follow the source's name. */
  label?: string;
}
