// Baseline workshop: which plotted channels an estimate reads (split out of
// useBaseline.ts). A secondary-X Y is estimated against its OWN X; a batch
// target matches the active binding's channels BY LABEL.

import { fullPlottedX, plottedYKey } from "../../../lib/fitselectionActions";
import { magXAxis } from "../../../lib/magDataKind";
import { ownXKey } from "../../../lib/perSeriesX";
import { tokenOf } from "../../../lib/previewKey";
import type { Dataset } from "../../../lib/types";

export interface BaselineBinding {
  datasetId: string;
  xKey: number | null;
  yKey: number;
  xLabel: string;
  yLabel: string;
}

export interface BaselineInput {
  binding: BaselineBinding;
  x: number[];
  y: number[];
}

export function baselineInput(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): BaselineInput | null {
  const yKey = plottedYKey(ds, xKey, yKeys, seriesOrder);
  if (yKey == null) return null;
  // A secondary-X Y (R2 in T1,R1,T2,R2) is estimated against its OWN X.
  const ownX = ownXKey(ds, xKey, yKey);
  const x = fullPlottedX(ds.data, ownX);
  const y = ds.data.values.map((row) => row[yKey]);
  if (x.length === 0 || x.length !== y.length) return null;
  return {
    binding: {
      datasetId: ds.id,
      xKey: ownX,
      yKey,
      xLabel: ownX == null ? magXAxis(ds.data, null).label || "Time" : (ds.data.labels[ownX] ?? `Channel ${ownX + 1}`),
      yLabel: ds.data.labels[yKey] ?? `Channel ${yKey + 1}`,
    },
    x,
    y,
  };
}

/** Batch target: the SAME channels (by column label) as the active binding; the
 *  plot's index-based selection means something else in another column layout. */
export function batchInput(ds: Dataset, ref: BaselineBinding | null): BaselineInput | string {
  if (!ref) return "select a plotted Y channel first";
  const yKey = ds.data.labels.indexOf(ref.yLabel);
  const xKey = ref.xKey == null ? null : ds.data.labels.indexOf(ref.xLabel);
  if (yKey < 0 || xKey === -1) return `${ds.name}: no "${yKey < 0 ? ref.yLabel : ref.xLabel}" column`;
  return baselineInput(ds, xKey, [yKey], null) ?? `${ds.name}: no usable Y channel`;
}

// Estimate on a still-loading book: compute() resolves it first, which swaps
// the store's Dataset object. The loaded object keeps the pending one's input
// token, so that swap (caused by the estimate itself) neither makes the
// estimate stale nor resets the anchors; any later edit still does.
const loadedFrom = new WeakMap<Dataset, number>();
/** Books being loaded by an Estimate: dataset id -> the pending input token. */
export const loadingBooks = new Map<string, number>();
export function inputToken(ds: Dataset): number {
  const inherited = loadingBooks.get(ds.id);
  if (inherited !== undefined && !ds.pending && !loadedFrom.has(ds)) {
    loadedFrom.set(ds, inherited); // the first loaded object after the swap
    loadingBooks.delete(ds.id);
  }
  return loadedFrom.get(ds) ?? tokenOf(ds);
}
