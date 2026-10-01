// F4.2c (a) on the Stage's xy FACET grid — focused (`MultiPanelStage`) and
// background (`BackgroundStackWindow`) windows alike: with the app-wide
// "Excluded rows" mode on "greyed", each facet panel draws its own excluded /
// filter-dropped rows as muted "(excluded)" companions, as the flat plot does
// (`lib/facetExcluded.greyFacetPanels`, the rule the export shares). Returns
// the composition unchanged for any other arrangement, the "hide" mode, or a
// grid with nothing dropped. An ENCODED grid (`useFacetEncoding`) draws its own
// panels and still hides them.

import { useMemo } from "react";

import { facetComposition, facetPanelsOf, type Composition } from "../../lib/composition";
import { greyFacetPanels } from "../../lib/facetExcluded";
import { droppedRows } from "../../lib/rowstate";
import type { Dataset } from "../../lib/types";
import type { ExcludedDisplay } from "../../store/useApp";

export function useGreyedFacets(
  composition: Composition | null,
  dataset: Dataset | null | undefined,
  facetKey: number | null | undefined,
  xKey: number | null,
  excludedDisplay: ExcludedDisplay,
): Composition | null {
  return useMemo(() => {
    const panels = facetPanelsOf(composition);
    if (!panels || excludedDisplay !== "grey" || !dataset || facetKey == null) return composition;
    const greyed = greyFacetPanels(panels, dataset.data, facetKey, xKey, droppedRows(dataset));
    return greyed.every((p, i) => p === panels[i]) ? composition : facetComposition(greyed);
  }, [composition, dataset, facetKey, xKey, excludedDisplay]);
}
