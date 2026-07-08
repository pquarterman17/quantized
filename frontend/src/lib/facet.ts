// Faceting + axis-break suggestion (ORIGIN_GAP_PLAN #21). Pure — no React /
// store / fetch.
//
// LANE NOTE: `lib/multipanel.ts` / `MultiPanelStage.tsx` are owned by a
// sibling workstream (Origin spatial apply) for this pass, so this module
// produces facet configs WITHOUT editing either file. `facetPayloads`'
// output ({label, payload}[]) is deliberately shaped close to
// `multipanel.splitPayload`'s `PlotPayload[]` so a future MultiPanelStage
// facet mode is a small, additive consume (swap `splitPayload(payload)` for
// `facetPayloads(...).map(f => f.payload)` plus per-panel labels) — see
// plans/GAP_PLOTTYPES_PLAN.md's Completed note for what that follow-up still
// needs. Today's actual consumer is the Graph Builder preview
// (GraphPreview.tsx), which is NOT sibling-owned and renders a small-
// multiples grid directly from `facetPayloads`.

import { categoryLevels, resolveCategoryLabels } from "./barlayout";
import { buildColumns, type PlotPayload } from "./plotdata";
import type { DataStruct } from "./types";

export interface FacetPanel {
  label: string;
  payload: PlotPayload;
}

/** Split `data` into one panel per distinct level of `facetCol`: each panel's
 *  payload is built (via `buildColumns`, same xKey/yChannels semantics as the
 *  main plot) from ONLY the rows at that level. Category labels resolve the
 *  same way bar charts do (`lib/barlayout.resolveCategoryLabels` — a metadata
 *  text-label column when present, else formatted numeric levels). Rows
 *  whose facet value is non-finite belong to no panel (dropped everywhere).
 *  `[]` when `facetCol` has no finite levels at all. */
export function facetPayloads(
  data: DataStruct,
  facetCol: number,
  xKey: number | null,
  yChannels: number[] | null,
): FacetPanel[] {
  const by = facetCol < 0 ? data.time : data.values.map((row) => row[facetCol]);
  const levels = categoryLevels(data, facetCol);
  if (levels.length === 0) return [];
  const labels = resolveCategoryLabels(data, facetCol, levels);
  return levels.map((lvl, i) => {
    const rows: number[] = [];
    for (let r = 0; r < by.length; r++) if (by[r] === lvl) rows.push(r);
    const sliced: DataStruct = {
      ...data,
      time: rows.map((r) => data.time[r]),
      values: rows.map((r) => data.values[r]),
    };
    return { label: labels[i], payload: buildColumns(sliced, null, xKey, yChannels) };
  });
}

/** Suggest manual axis breaks by gap detection over a (usually sorted) x
 *  column: any adjacent-point gap at least `gapFactor`× the MEDIAN adjacent
 *  gap is a candidate break — the elided `[loBeforeGap, hiAfterGap]` x-range.
 *  Pure detection only (no decision on how many breaks to keep — a caller
 *  can sort the result by gap width and take the top N). Matches the export
 *  contract `calc.figure._validate_overrides`'s `x_breaks` expects: sorted,
 *  non-overlapping `[lo, hi]` pairs with `lo < hi`, `lo`/`hi` both inside the
 *  data range. Needs >=3 finite points to have a meaningful "typical" gap;
 *  returns `[]` otherwise. */
export function suggestBreaks(xs: readonly number[], gapFactor = 4): [number, number][] {
  const finite = xs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length < 3) return [];
  const gaps: number[] = [];
  for (let i = 1; i < finite.length; i++) gaps.push(finite[i] - finite[i - 1]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
  if (!(median > 0)) return [];
  const breaks: [number, number][] = [];
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] >= median * gapFactor) breaks.push([finite[i], finite[i + 1]]);
  }
  return breaks;
}
