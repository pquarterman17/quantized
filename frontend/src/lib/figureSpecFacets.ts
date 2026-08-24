// F4.4 (export half — FIGURE_AUTHORING_WORKFLOW_PLAN): the resolved-facet-
// panel wire builder, split out of lib/figureSpec.ts purely to keep that
// file under the general 500-line .ts module ceiling (architecture.test.ts's
// RSM_CUTS_PLAN #20 guard) -- `buildFigureSpecForView` is the ONE caller,
// and stays there.
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
// Fix-round C2: `liveDataset`, when given, is the bound live `Dataset` --
// its exclusion/filter state prunes `data` (via `droppedRows`/
// `pruneExcluded`, the exact primitives `lib/rowstate.analysisData` is
// built from) BEFORE partitioning, so a facet export is drawn from the SAME
// view the screen's own facet grid uses (`facetCompositionFromBinding`) and
// can never contain excluded rows or grow an extra panel for a level that's
// fully excluded on screen. Absent for a frozen document, which has no such
// state of its own. (The flat, non-faceted export path has its own
// separate, pre-existing row-exclusion gap -- untouched here; see
// `plans/FIGURE_AUTHORING_WORKFLOW_PLAN.md`'s F4.4 note.)

import type { FigureFacetSpec } from "./api/figures";
import { facetPayloads } from "./facet";
import { droppedRows, pruneExcluded } from "./rowstate";
import type { Dataset, DataStruct } from "./types";

/** Resolves `facetCol`'s row partition into wire-shaped panels. Returns
 *  `undefined` when the column has no finite levels to facet on -- mirrors
 *  the SCREEN's own fallback (`facetCompositionFromBinding` returns `null`
 *  for the identical state, and `useEffectiveComposition` then renders the
 *  ordinary flat plot) rather than throwing (fix-round C5): an export must
 *  show the same thing the user is actually looking at, never refuse
 *  outright for a state the screen itself renders fine. */
export function buildFacetSpecs(
  data: DataStruct,
  facetCol: number,
  xKey: number | null,
  yKeys: number[] | null,
  liveDataset?: Dataset | null,
): FigureFacetSpec[] | undefined {
  const view = liveDataset ? pruneExcluded(data, droppedRows(liveDataset)) : data;
  const panels = facetPayloads(view, facetCol, xKey, yKeys);
  if (panels.length === 0) return undefined;
  return panels.map((p) => ({
    label: p.label,
    x: p.payload.data[0] as (number | null)[],
    series: p.payload.series.map((s, i) => ({
      label: s.unit ? `${s.label} (${s.unit})` : s.label,
      y: p.payload.data[i + 1] as (number | null)[],
    })),
  }));
}

/** `buildFigureSpecForView`'s single "do we even build facets" gate PLUS its
 *  "nothing to export" guard, in one place. Omits facets (`undefined`) when
 *  there's no `facetKey` bound (R7's live-singleton dataset-mismatch race
 *  is handled UPSTREAM, by the caller nulling `facetKey` before this ever
 *  runs -- see `buildFigureSpec`'s own doc), or when `buildFacetSpecs`
 *  itself returns `undefined` (C5's degenerate-partition fallback). Then
 *  throws "no visible series to export" only when there's neither a flat
 *  series (`plottedCount`) NOR a facet grid -- R4 lets an all-hidden
 *  FACETED view through, since the grid needs no flat series at all and the
 *  screen's own facet grid ignores `hiddenChannels` too. `data`/`xKey`/
 *  `yKeys`/`liveDataset` mean exactly what `buildFacetSpecs` documents. */
export function resolveFacetsOrThrow(
  data: DataStruct,
  facetKey: number | null,
  xKey: number | null,
  yKeys: number[] | null,
  liveDataset: Dataset | null | undefined,
  plottedCount: number,
): FigureFacetSpec[] | undefined {
  const facets = facetKey == null ? undefined : buildFacetSpecs(data, facetKey, xKey, yKeys, liveDataset);
  if (plottedCount === 0 && facets === undefined) throw new Error("no visible series to export");
  return facets;
}
