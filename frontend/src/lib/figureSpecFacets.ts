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
// its exclusion/filter state prunes `data` (via the shared
// `lib/rowstate.pruneToLiveDataset` -- the same primitives
// `lib/rowstate.analysisData` is built from) BEFORE partitioning, so a facet
// export is drawn from the SAME view the screen's own facet grid uses
// (`facetCompositionFromBinding`) and can never contain excluded rows or grow
// an extra panel for a level that's fully excluded on screen. Absent for a
// frozen document, which has no such state of its own. (The flat,
// non-faceted export path made the SAME substitution in a later slice --
// `lib/figureSpec.ts`'s `buildFigureSpecForView` calls the identical
// `pruneToLiveDataset` helper rather than duplicating this logic; see
// `plans/FIGURE_AUTHORING_WORKFLOW_PLAN.md`'s F4.4 note.)

import type { FigureFacetSpec } from "./api/figures";
import { buildExportStyles, toWireSeriesStyles } from "./exportStyles";
import {
  facetPayloads,
  facetSliceRowIds,
  facetSlices,
  type FacetPanel,
} from "./facet";
import { seriesDisplayLabel } from "./seriesDisplayLabel";
import { activeRowIndices, droppedRows, pruneToLiveDataset } from "./rowstate";
import type { Dataset, DataStruct, SeriesStyle } from "./types";

/** FEATURE-001: one panel's wire styles -- the channel-keyed `styles`
 *  projected through the panel's OWN `channels` (the screen's
 *  `Stage/facetGridRender.facetPanelStyles`), then through the ONE wire
 *  boundary every `series_styles` producer uses, under the GROUPED rule: a
 *  chosen colour is sent, a palette-derived one never is (the panel's own
 *  cycle colours an unstyled series on screen and in matplotlib alike, and a
 *  facet series has no flat display position to derive one from). */
export function facetPanelWireStyles(
  panel: Pick<FacetPanel, "channels">,
  styles: Record<number, SeriesStyle>,
): ReturnType<typeof toWireSeriesStyles> {
  return toWireSeriesStyles(
    buildExportStyles(panel.channels, styles, null, false, true),
    true,
  );
}

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
  seriesLabels: Record<number, string> = {},
  seriesStyles: Record<number, SeriesStyle> = {},
): FigureFacetSpec[] | undefined {
  const view = pruneToLiveDataset(data, liveDataset);
  const panels = facetPayloads(view, facetCol, xKey, yKeys);
  if (panels.length === 0) return undefined;
  return panels.map((p) => {
    const styles = facetPanelWireStyles(p, seriesStyles);
    return {
      label: p.label,
      x: p.payload.data[0] as (number | null)[],
      series: p.payload.series.map((s, i) => ({
        // BUG-014 (review round): a panel ships a FINISHED string, so the
        // rename rule has to be applied HERE -- the flat path can defer it to
        // the renderer through `series_styles[i].legend`, and a facet panel has
        // no per-series field on the request to defer to. `seriesDisplayLabel`
        // IS that rule (rename verbatim, else "label (unit)"), shared with the
        // flat export and matching `uplotOpts.buildOpts`' own resolution --
        // which `Stage/facetGridRender.ts` now feeds the SAME `seriesLabels`,
        // so the facet grid reads identically on screen and in the export.
        // The channel behind series `i` comes from the panel itself
        // (`FacetPanel.channels`): the default (null `yKeys`) channel list is
        // resolved per row-slice and can legitimately differ panel to panel.
        label: seriesDisplayLabel(s.label, s.unit, seriesLabels[p.channels[i]]),
        y: p.payload.data[i + 1] as (number | null)[],
        // FEATURE-001: the channel's style, by the same per-panel projection.
        ...(styles[i] ? { style: styles[i] } : {}),
      })),
    };
  });
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
 *  `yKeys`/`liveDataset`/`seriesLabels`/`seriesStyles` mean exactly what
 *  `buildFacetSpecs` documents. */
export function resolveFacetsOrThrow(
  data: DataStruct,
  facetKey: number | null,
  xKey: number | null,
  yKeys: number[] | null,
  liveDataset: Dataset | null | undefined,
  plottedCount: number,
  seriesLabels: Record<number, string> = {},
  seriesStyles: Record<number, SeriesStyle> = {},
): FigureFacetSpec[] | undefined {
  const facets =
    facetKey == null
      ? undefined
      : buildFacetSpecs(
          data,
          facetKey,
          xKey,
          yKeys,
          liveDataset,
          seriesLabels,
          seriesStyles,
        );
  if (plottedCount === 0 && facets === undefined)
    throw new Error("no visible series to export");
  return facets;
}

/** P1.4 residual 3: `facets` (`buildFacetSpecs`' panels for the same `data`,
 *  `facetCol` and `liveDataset`, in the same order) for an ENCODED or GROUPED
 *  request (`plotEncodingBinding.facetSplitEncoding`) —
 *  each panel names the row of `data` behind each x entry and its Y channels
 *  (`yKeys`, the same in every panel), and each series its channel's rename,
 *  so the route re-splits the panel by the encoding
 *  (`calc/plotting_encoded_facets.py`) as the Stage's facet grid does
 *  (`Stage/useFacetEncoding`). */
export function withFacetRows(
  facets: readonly FigureFacetSpec[],
  data: DataStruct,
  facetCol: number,
  yKeys: readonly number[],
  liveDataset: Dataset | null | undefined,
  seriesLabels: Record<number, string>,
): FigureFacetSpec[] {
  const kept = liveDataset
    ? activeRowIndices(data.time.length, droppedRows(liveDataset))
    : null;
  const slices = facetSlices(pruneToLiveDataset(data, liveDataset), facetCol);
  return facets.map((f, i) => ({
    ...f,
    rows: facetSliceRowIds(slices[i], kept),
    channels: [...yKeys],
    series: f.series.map((s, j) => {
      const legend = seriesLabels[yKeys[j]];
      return legend === undefined ? s : { ...s, legend };
    }),
  }));
}
