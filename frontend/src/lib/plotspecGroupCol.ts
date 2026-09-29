// How a spec's X well resolves to a column, by ONE rule per question, shared
// by every renderer so none reads the X well differently:
//   • `specXKey` — the plotted X column. The spec model's reserved negative
//     channel (`OWN_X_CHANNEL`, the dataset's own x/time column) means the
//     same null xKey an empty X well means, which is also what the export
//     wire sends (`x_key` omitted). Never pass `zones.x.channel` straight
//     through as a column index: `row[-1]` is an all-empty X.
//   • `specGroupCol` — the categorical marks' (box / violin / bar) group
//     axis, shared by the render (`lib/plotspec.specToRender`) and the
//     preview's marks (`workshops/graphbuilder/previewMarks`, JMP_GAP J5
//     residual) so the two can never resolve points against a different
//     column than the boxes / bars they sit on.

import { channelModelingType, isCategorical } from "./modeling";
import type { PlotSpec } from "./plotspec";
import type { Dataset } from "./types";

/** The channel an X-well ref carries for the dataset's own x/time column. */
export const OWN_X_CHANNEL = -1;

/** The X column to plot against: a value-column index, or null for the
 *  dataset's own X (an empty well or the reserved negative channel). */
export function specXKey(spec: PlotSpec): number | null {
  const channel = spec.zones.x?.channel;
  return channel === undefined || channel < 0 ? null : channel;
}

/** The categorical X column (the group axis), or null when X is absent, the
 *  dataset's own X, or not categorical (box / violin then group per Y
 *  channel; bar refuses). */
export function specGroupCol(spec: PlotSpec, ds: Dataset): number | null {
  const x = specXKey(spec);
  return x !== null && isCategorical(channelModelingType(ds, x)) ? x : null;
}
