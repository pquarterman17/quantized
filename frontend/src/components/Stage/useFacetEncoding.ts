// P1.4 residual 3: Color-by / Symbol-by / legend-label source on the Stage's
// xy FACET grid — focused (`MultiPanelStage`) and background
// (`BackgroundStackWindow`) windows alike. The picks are the window's document
// (`FigureBindings.encoding`), gated by the SAME `windowEncoding` the flat
// Stage and the export use, less a gradient, or Group ALONE with no encoding
// (`facetSplitEncoding` -- a grouped grid splits each panel's series by level
// as the flat plot does), over the
// window's explicit Y channels or, with none, the FLAT plot's default list
// (`lib/facet.facetSplitChannels` — the same in every panel, as the split
// needs) — the export's own gate (`figureSpec.ts`), so screen and PDF agree
// on whether a grid is encoded at all and over which channels.
//
// The derivation is `lib/plotEncoding.encodedFacetPanels`, the one the Graph
// Builder preview draws: the split is taken over the dataset's FULL rows (the
// flat Stage's rule), and the panels are the grid's own partition — the
// analysis view sliced by the facet column (`facetCompositionFromBinding`'s
// `facetPayloads` call) — with each slice's rows mapped back to dataset rows,
// which is exactly what the export sends (`figureSpecFacets.withFacetRows`)
// for the backend port (`calc/plotting_encoded_facets.py`) to re-split. With
// the "Excluded rows" mode on "greyed" (F4.2c (a)), each panel is its FULL
// level and draws its dropped rows as one grey companion per Y channel
// (`lib/facetEncodedExcluded`), as the export does. Loaded lazily, like the
// flat encoding; until it resolves the grid draws unencoded.

import { useMemo } from "react";

import { facetSlices, type FacetPanel } from "../../lib/facet";
import { facetSliceRowIds, facetSplitChannels } from "../../lib/facetDomains";
import { facetFullSlices } from "../../lib/facetExcluded";
import { windowEncoding, type FigureEncoding } from "../../lib/plotEncodingBinding";
import { facetSplitEncoding } from "../../lib/plotEncodingWire";
import { analysisView, droppedRows } from "../../lib/rowstate";
import type { Dataset, SeriesStyle } from "../../lib/types";
import { useStableByValue } from "../../lib/useStableValue";
import type { ExcludedDisplay } from "../../store/useApp";
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

/** The grid's encoding (see the module doc), or null: no facet column, no Y
 *  channel (explicit or default), no surviving pick and no group, or the
 *  derivation not loaded yet. */
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
  excludedDisplay: ExcludedDisplay = "hide",
): FacetEncodingRender | null {
  const stablePicks = useStableByValue(picks, (v) => JSON.stringify(v));
  const enc = useMemo(
    () =>
      active && facetKey != null
        ? facetSplitEncoding(windowEncoding(stablePicks, active, groupCol, y2Keys), groupCol)
        : null,
    [active, stablePicks, groupCol, y2Keys, facetKey],
  );
  const mod = useEncodingModule(enc !== null);
  return useMemo(() => {
    if (!enc || !mod || !active || facetKey == null) return null;
    const view = analysisView(active);
    if (!view.data) return null;
    const channels = facetSplitChannels(view.data, xKey, yKeys);
    if (!channels) return null;
    const slices = facetSlices(view.data, facetKey).map((s) => ({ ...s, rows: facetSliceRowIds(s, view.rowIds) }));
    const renames = channels.map((c) => seriesLabels[c]);
    // F4.2c (a) greyed: FULL level panels, the dropped rows as grey companions.
    const dropped = excludedDisplay === "grey" ? droppedRows(active) : undefined;
    const shown = dropped?.size ? facetFullSlices(slices, active.data, facetKey).map((s, i) => s ?? slices[i]) : slices;
    // FEATURE-001: each series' encoding over its CHANNEL's own style.
    const panels = mod.encodedFacetPanels(
      mod.encodingData(active.data, enc), shown, xKey, channels, enc, renames, seriesStyles, dropped,
    );
    return { panels, styles: panels.map((p) => p.styles), labels: panels.map((p) => p.labels) };
  }, [enc, mod, active, facetKey, xKey, yKeys, seriesLabels, seriesStyles, excludedDisplay]);
}
