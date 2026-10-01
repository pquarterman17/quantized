// Greyed excluded rows on a SPLIT xy facet grid (Color / Symbol / Label, or
// Group alone) — FIGURE_AUTHORING_WORKFLOW_PLAN F4.2c (a), the split form of
// `./facetExcluded` (the unsplit grid's rule).
//
// THE RULE. Each panel is its level sliced from the FULL rows (as the unsplit
// greyed grid re-slices it), so every excluded / filter-dropped row sits in
// place. The split series keep only the KEPT rows: a level combination whose
// rows in a panel are all dropped has no series there, as in the hidden grid.
// The dropped rows are drawn by ONE muted "(excluded)" companion per Y channel
// per panel, appended after the split series — the flat plot's own companion
// (`plotdata.maskExcludedPayload`), never split or coloured by level. The
// export draws the same (`calc/plotting_encoded_facets.py`, pinned to this by
// `tests/fixtures/wire/facet_excluded.json`).
//
// LAZY: imported only by `./plotEncoding`.

import { maskExcludedPayload, type PlotPayload } from "./plotdata";

/** `split` (a panel's encoded payload, over `base`'s rows) plus one muted
 *  companion per Y channel of `base` holding only the panel's `dropped` rows
 *  (`rows[j]` is the dataset row behind position j). `split` itself when the
 *  panel holds no dropped row. */
export function withChannelCompanions(
  split: PlotPayload,
  base: PlotPayload,
  rows: readonly number[],
  dropped: ReadonlySet<number> | undefined,
): PlotPayload {
  const local = new Set<number>();
  rows.forEach((r, j) => dropped?.has(r) && local.add(j));
  if (local.size === 0) return split;
  const n = base.series.length;
  const masked = maskExcludedPayload(base, local, "grey"); // [x, kept…, companions…]
  return {
    ...split,
    data: [...split.data, ...masked.data.slice(1 + n)] as PlotPayload["data"],
    series: [...split.series, ...masked.series.slice(n)],
  };
}
