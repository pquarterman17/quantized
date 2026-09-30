// P1.4 residual 3: Color-by / Symbol-by / legend-label source on the Stage's
// xy FACET grid — focused (`MultiPanelStage`) and background
// (`BackgroundStackWindow`) windows alike. The picks are the window's document
// (`FigureBindings.encoding`), gated by the SAME `windowEncoding` the flat
// Stage and the export use, less a gradient (`facetEncoding`), and only over
// explicit Y channels — the export's own gate (`figureSpec.ts`), so screen and
// PDF agree on whether a grid is encoded at all.
//
// The derivation is `lib/plotEncoding.encodedFacetPanels`, the one the Graph
// Builder preview draws: the split is taken over the dataset's FULL rows (the
// flat Stage's rule), and the panels are the grid's own partition — the
// analysis view sliced by the facet column (`facetCompositionFromBinding`'s
// `facetPayloads` call) — with each slice's rows mapped back to dataset rows,
// which is exactly what the export sends (`figureSpecFacets.withFacetRows`)
// for the backend port (`calc/plotting_encoded_facets.py`) to re-split.
// Loaded lazily, like the flat encoding; until it resolves the grid draws
// unencoded.

import { useMemo } from "react";

import { facetSliceRowIds, facetSlices, type FacetPanel } from "../../lib/facet";
import { facetEncoding, windowEncoding, type FigureEncoding } from "../../lib/plotEncodingBinding";
import { analysisView } from "../../lib/rowstate";
import type { Dataset, SeriesStyle } from "../../lib/types";
import { useStableByValue } from "../../lib/useStableValue";
import { useEncodingModule } from "./usePlotEncoding";

/** An encoded facet grid: its panels, and per panel each series' style and
 *  FINISHED legend text (the channel renames applied). */
export interface FacetEncodingRender {
  panels: FacetPanel[];
  styles: SeriesStyle[][];
  labels: string[][];
}

const EMPTY_LABELS: Record<number, string> = {};
const EMPTY_STYLES: Record<number, SeriesStyle> = {};

/** The grid's encoding (see the module doc), or null: no facet column, no
 *  explicit Y channels, no surviving pick, or the derivation not loaded yet. */
export function useFacetEncoding(
  active: Dataset | null | undefined,
  picks: FigureEncoding | undefined,
  groupCol: number | null,
  y2Keys: readonly number[] | null,
  facetKey: number | null | undefined,
  xKey: number | null,
  yKeys: readonly number[] | null,
  seriesLabels: Record<number, string> = EMPTY_LABELS,
  seriesStyles: Record<number, SeriesStyle> = EMPTY_STYLES,
): FacetEncodingRender | null {
  const stablePicks = useStableByValue(picks, (v) => JSON.stringify(v));
  const enc = useMemo(
    () =>
      active && facetKey != null && yKeys && yKeys.length > 0
        ? facetEncoding(windowEncoding(stablePicks, active, groupCol, y2Keys))
        : null,
    [active, stablePicks, groupCol, y2Keys, facetKey, yKeys],
  );
  const mod = useEncodingModule(enc !== null);
  return useMemo(() => {
    if (!enc || !mod || !active || facetKey == null || !yKeys) return null;
    const view = analysisView(active);
    if (!view.data) return null;
    const slices = facetSlices(view.data, facetKey).map((s) => ({ ...s, rows: facetSliceRowIds(s, view.rowIds) }));
    const renames = yKeys.map((c) => seriesLabels[c]);
    // FEATURE-001: each series' encoding over its CHANNEL's own style.
    const panels = mod.encodedFacetPanels(
      mod.encodingData(active.data, enc), slices, xKey, yKeys, enc, renames, seriesStyles,
    );
    return { panels, styles: panels.map((p) => p.styles), labels: panels.map((p) => p.labels) };
  }, [enc, mod, active, facetKey, xKey, yKeys, seriesLabels, seriesStyles]);
}
