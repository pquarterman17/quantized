// The Graph Builder's categorical marks (box / violin / bar) take their group
// axis from a spec by ONE rule, shared by the render (`lib/plotspec.
// specToRender`) and the preview's marks (`workshops/graphbuilder/
// previewMarks`, JMP_GAP J5 residual) so the two can never resolve points
// against a different column than the boxes / bars they sit on.

import { channelModelingType, isCategorical } from "./modeling";
import type { PlotSpec } from "./plotspec";
import type { Dataset } from "./types";

/** The categorical X column (the group axis), or null when X is absent or
 *  not categorical (box / violin then group per Y channel; bar refuses). */
export function specGroupCol(spec: PlotSpec, ds: Dataset): number | null {
  const x = spec.zones.x;
  return x && isCategorical(channelModelingType(ds, x.channel)) ? x.channel : null;
}
