// Greyed excluded rows on the xy FACET grid (FIGURE_AUTHORING_WORKFLOW_PLAN
// F4.2c (a)), shared by the screen (`Stage/useGreyedFacets`) and the export
// (`excludedRowsExport.withExcludedGhosts`), so the two cannot disagree.
//
// THE RULE. The panels are the screen's own partition: the analysis view
// (excluded and filter-dropped rows removed) sliced by the facet column
// (`facet.facetPayloads`), each with its own Y channels. A panel's GREYED form
// is the same level sliced from the FULL rows, over the same channels, so its
// excluded rows sit in place: on screen `plotdata.maskExcludedPayload` blanks
// them and appends one muted "(excluded)" companion per series, as the flat
// plot does; on the wire the panel carries the full rows plus the dataset
// `rows` behind them and the request's `excluded_rows` mask, and the route
// draws the companions (`calc/figure_facets_excluded.py`). A level whose every
// row is excluded has no panel in either mode.

import type { FigureFacetSpec } from "./api/figures";
import { facetPayloads, facetSlices, type FacetPanel, type FacetSlice } from "./facet";
import type { ExcludedFacetBinding } from "./figureSpec";
import { buildColumns, maskExcludedPayload } from "./plotdata";
import { pruneExcluded } from "./rowstate";
import type { DataStruct } from "./types";

/** Each panel's level sliced from the FULL rows (matched by its level label),
 *  or null for a panel whose level has no full slice. */
export function facetFullSlices(
  panels: readonly Pick<FacetPanel, "label">[],
  data: DataStruct,
  facetCol: number,
): (FacetSlice | null)[] {
  const byLabel = new Map(facetSlices(data, facetCol).map((s) => [s.label, s] as const));
  return panels.map((p) => byLabel.get(p.label) ?? null);
}

/** The panels to draw with excluded rows greyed: each panel that holds a
 *  `dropped` row is rebuilt from its full level and masked (see the module
 *  doc); the others, and every panel when nothing is dropped, are returned
 *  as they are. */
export function greyFacetPanels(
  panels: FacetPanel[],
  data: DataStruct,
  facetCol: number,
  xKey: number | null,
  dropped: ReadonlySet<number>,
): FacetPanel[] {
  if (dropped.size === 0) return panels;
  const full = facetFullSlices(panels, data, facetCol);
  return panels.map((p, i) => {
    const slice = full[i];
    const local = new Set<number>();
    slice?.rows.forEach((r, j) => dropped.has(r) && local.add(j));
    if (!slice || local.size === 0) return p;
    return { ...p, payload: maskExcludedPayload(buildColumns(slice.data, null, xKey, p.channels), local, "grey") };
  });
}

/** The wire form of the same rule, for a finished facet request
 *  (`excludedRowsExport.withExcludedGhosts`): each of `facets` (built from the
 *  analysis view of `data`) re-sliced from its full level, with the dataset
 *  `rows` behind its `x`. The labels, legends and styles ride unchanged. A
 *  SPLIT grid's panels (they name their `channels`, `figureSpecFacets.
 *  withFacetRows`) are re-split by the route, which greys them
 *  (`lib/facetEncodedExcluded`). Null when the panels do not line up with
 *  `data`'s partition (nothing to grey). */
export function greyFacetSpecs(
  facets: readonly FigureFacetSpec[],
  data: DataStruct,
  facet: ExcludedFacetBinding,
  xKey: number | null,
  dropped: ReadonlySet<number>,
): FigureFacetSpec[] | null {
  const split = facets.every((f) => f.channels?.length);
  const panels = split
    ? facets.map((f) => ({ label: f.label, channels: f.channels as number[] }))
    : facetPayloads(pruneExcluded(data, dropped), facet.col, xKey, facet.yKeys);
  if (panels.length !== facets.length || panels.some((p, i) => p.label !== facets[i].label)) return null;
  const full = facetFullSlices(panels, data, facet.col);
  const out: FigureFacetSpec[] = [];
  for (const [i, f] of facets.entries()) {
    const slice = full[i];
    if (!slice || f.series.length !== panels[i].channels.length) return null;
    const cols = buildColumns(slice.data, null, xKey, panels[i].channels).data as (number | null)[][];
    out.push({ ...f, x: cols[0], rows: [...slice.rows], series: f.series.map((s, j) => ({ ...s, y: cols[j + 1] })) });
  }
  return out;
}
