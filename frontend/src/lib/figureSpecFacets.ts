// F4.4 (export half — FIGURE_AUTHORING_WORKFLOW_PLAN): the resolved-facet-
// panel wire builder, split out of lib/figureSpec.ts purely to keep that
// file under the general 500-line .ts module ceiling (architecture.test.ts)
// -- `buildFigureSpecForView` is the ONE caller, and stays there.
//
// Closes the named export gap: FigureSpec previously had no transport
// fields for a facet binding at all. Resolves `facetCol`'s row partition
// via the EXACT same primitive the on-screen facet grid uses
// (`facetByColumn`/`facetCompositionFromBinding`'s own `facetPayloads`
// call), against the raw `xKey`/`yKeys` -- never the hidden/seriesOrder-
// adjusted `plotted` list, because the on-screen facet grid ignores both
// too (`useMultiPanelStage.ts`'s facet branch renders `store.facetPanels`
// as-is, with no further hidden-channel filtering). Sending this RESOLVED
// partition, rather than a bare column index, means the backend never
// re-derives level ordering/binning and so can never disagree with what
// Stage showed -- the same reasoning `StatplotFacetSpec`/`CategoricalFacetSpec`
// already establish for the stat-stage facet grids.
//
// Deliberately reads `data` as already resolved by the caller (a frozen
// snapshot or a live document's bound `Dataset.data`) rather than
// `lib/rowstate.analysisData`'s row-excluded/filtered view: no other field
// `buildFigureSpecForView` builds honors row exclusion either (that module
// never imports `analysisData`), so facet export stays internally
// consistent with the rest of this export path instead of special-casing
// just the facet grid to a different data view.

import type { FigureFacetSpec } from "./api/figures";
import { facetPayloads } from "./facet";
import type { DataStruct } from "./types";

/** Throws when the column has no finite levels to facet on (mirrors
 *  `facetByColumn`'s own "no finite levels" toast) rather than silently
 *  falling back to a flat overlaid plot — an export must fail loudly, not
 *  quietly stop being a facet grid. */
export function buildFacetSpecs(
  data: DataStruct,
  facetCol: number,
  xKey: number | null,
  yKeys: number[] | null,
): FigureFacetSpec[] {
  const panels = facetPayloads(data, facetCol, xKey, yKeys);
  if (panels.length === 0) {
    throw new Error(`facet column ${facetCol} has no finite levels to export`);
  }
  return panels.map((p) => ({
    label: p.label,
    x: p.payload.data[0] as (number | null)[],
    series: p.payload.series.map((s, i) => ({
      label: s.unit ? `${s.label} (${s.unit})` : s.label,
      y: p.payload.data[i + 1] as (number | null)[],
    })),
  }));
}
