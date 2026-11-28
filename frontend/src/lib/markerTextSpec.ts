// Per-point text symbols laid over a FINISHED export request (plan item 24; lazy, in the marks chunk, so the
// request builder pays one call). A facet request gets each panel's texts (`facetMarkerTexts.withFacetTexts`);
// every other request gets its series' texts aligned to the dataset the request holds (`markerTextWire`: the
// pruned rows of a flat, grouped or per-series-X request, every row of an encoded one). The same reference comes
// back when no series asks.

import type { FigureSpec } from "./api/figures";
import { withFacetTexts } from "./facetMarkerTexts";
import { withMarkerTextWire } from "./markerTextWire";
import type { PlotView } from "./plotview";
import type { DataStruct, Dataset } from "./types";

/** `spec` with per-point texts. `src` is the sheet before any row window or per-series-X view, `live` the
 *  dataset the request was pruned by, `encoded` whether the request keeps every row (an encoding blanks the
 *  excluded ones server-side), `split` whether a facet grid is split by a group or an encoding (refused). */
export function withSpecTexts(
  spec: FigureSpec,
  view: PlotView,
  data: DataStruct,
  src: Dataset | null | undefined,
  live: Dataset | null | undefined,
  encoded: boolean,
  split: boolean,
): FigureSpec {
  if (spec.facets) {
    const facets = withFacetTexts(spec.facets, view, data, src, live, split);
    return facets === spec.facets ? spec : { ...spec, facets };
  }
  const styles = withMarkerTextWire(spec.series_styles ?? null, (spec.y_keys ?? []) as number[], view.seriesStyles, {
    src, live, range: view.rowRange, rows: spec.dataset.time.length, all: encoded,
  });
  return styles === (spec.series_styles ?? null) || !styles ? spec : { ...spec, series_styles: styles };
}
