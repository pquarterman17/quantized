// Per-point text symbols on the focused plot's facet grid (plan item 24): the grid's panels with each series' style
// carrying the texts of its panel's rows (`lib/facetMarkerTexts`, lazy). It rides the grid's existing
// encoded-render seam (per-panel styles and finished legend text), so the grid itself is unchanged. Null (the plain
// grid) when no series asks for per-point text, the grid is split or greyed (refused, `facetTextRefusal`), or the
// marks chunk has not arrived (a series that asks is hidden meanwhile, `marksLoader`).

import { useMemo } from "react";

import { facetPanelsOf, type Composition } from "../../lib/composition";
import { marks, useMarksVersion } from "../../lib/marksLoader";
import { seriesDisplayLabel } from "../../lib/seriesDisplayLabel";
import type { RowRange } from "../../lib/rowRange";
import type { Dataset, SeriesStyle } from "../../lib/types";
import type { FacetEncodingRender } from "./useFacetEncoding";

export function useFacetTextStyles(
  composition: Composition | null,
  sheet: Dataset | null | undefined,
  view: Dataset | null | undefined,
  rowRange: RowRange | undefined,
  xKey: number | null,
  seriesStyles: Record<number, SeriesStyle>,
  seriesLabels: Record<number, string>,
  refused: boolean,
): FacetEncodingRender | null {
  const loaded = useMarksVersion();
  return useMemo(() => {
    const panels = facetPanelsOf(composition);
    const m = marks();
    if (refused || !m || !panels || !sheet || !view) return null;
    const offset = view === sheet ? 0 : rowRange?.from ?? 0;
    const styles = m.facetTextStyles(panels, seriesStyles, view, sheet, xKey, offset);
    if (!styles) return null;
    const labels = panels.map((p) => p.payload.series.map((s, i) => seriesDisplayLabel(s.label, s.unit, seriesLabels[p.channels[i]])));
    return { panels, styles: styles as SeriesStyle[][], labels };
  }, [composition, sheet, view, rowRange, xKey, seriesStyles, seriesLabels, refused, loaded]);
}
