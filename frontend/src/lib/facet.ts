// Faceting + axis-break suggestion (ORIGIN_GAP_PLAN #21). Pure — no React /
// store / fetch.
//
// Two consumers: the Graph Builder preview (GraphPreview.tsx) renders a
// small-multiples grid directly from `facetPayloads` for its own live-preview
// canvas; the interactive MAIN stage consumes it via the store's
// `facetByColumn` action, which populates `facetPanels` for
// `components/Stage/MultiPanelStage.tsx`'s facet-grid render mode (a THIRD
// mode alongside the plain per-channel stack and the Origin spatial apply —
// see that file's module doc). `sharedXDomain` below is that mode's one bit
// of derived state: a fixed x-range computed ONCE across every panel so the
// small multiples read on the same horizontal scale (the point of faceting
// is comparing shape across levels, not just presence).
//
// A FOURTH mode (gap #21's last residual) reuses `suggestBreaks`:
// `breakPayloads` slices one series into one panel per x-segment implied by a
// set of breaks, and the store's `breakAtGaps` action (mirrors
// `facetByColumn`) populates `breakPanels` for `MultiPanelStage`'s paneled
// x-break render. Breaks are the opposite sharing axis from facets: facet
// panels are independent row-slices that share ONE x-domain (`sharedXDomain`);
// break panels are contiguous x-slices of the SAME series that share ONE
// y-domain (`sharedYDomain`) and each keep their OWN local x-range.

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

/** Union x-domain across a set of facet panels — the min/max of every panel's
 *  own finite x values. `MultiPanelStage`'s facet-grid mode uses this as a
 *  fixed `xLim` applied to EVERY panel so the small multiples share one
 *  horizontal scale (unlike `SpatialPanel`, where each panel legitimately
 *  owns its own independent range). Null when no panel has any finite x
 *  value at all — the caller then leaves each panel to autoscale. */
export function sharedXDomain(panels: readonly FacetPanel[]): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of panels) {
    for (const v of p.payload.data[0] as (number | null)[]) {
      if (v == null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return min <= max ? [min, max] : null;
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

export interface BreakPanel {
  payload: PlotPayload;
  /** This panel's OWN local x-domain (min/max of its finite x values within
   *  the segment) — the per-panel `xLim` `MultiPanelStage` applies, since a
   *  break panel's whole point is showing only its own x-slice, not the full
   *  (elided-gap) span. */
  xRange: [number, number];
}

/** Split `data` into one panel per contiguous x-segment implied by `breaks`
 *  (sorted-or-not, non-overlapping `[lo, hi]` gap ranges — typically
 *  `suggestBreaks`'s own output): everything at or below the first break's
 *  `lo` is panel 0, everything between one break's `hi` and the next break's
 *  `lo` is the next panel, and everything at or above the last break's `hi`
 *  is the final panel. Each panel's payload is built via `buildColumns` from
 *  ONLY the rows whose x falls in that segment — the same row-slicing idiom
 *  `facetPayloads` uses. A segment with no finite x rows at all is dropped
 *  (never renders an empty panel). `[]` when `breaks` is empty. */
export function breakPayloads(
  data: DataStruct,
  xKey: number | null,
  yChannels: number[] | null,
  breaks: readonly [number, number][],
): BreakPanel[] {
  if (breaks.length === 0) return [];
  const sorted = [...breaks].sort((a, b) => a[0] - b[0]);
  const xs = xKey == null ? data.time : data.values.map((row) => row[xKey]);
  const segments: [number, number][] = [];
  let prevHi = -Infinity;
  for (const [lo, hi] of sorted) {
    segments.push([prevHi, lo]);
    prevHi = hi;
  }
  segments.push([prevHi, Infinity]);

  const panels: BreakPanel[] = [];
  for (const [lo, hi] of segments) {
    const rows: number[] = [];
    for (let r = 0; r < xs.length; r++) {
      const v = xs[r];
      if (Number.isFinite(v) && v >= lo && v <= hi) rows.push(r);
    }
    if (rows.length === 0) continue;
    const sliced: DataStruct = {
      ...data,
      time: rows.map((r) => data.time[r]),
      values: rows.map((r) => data.values[r]),
    };
    const payload = buildColumns(sliced, null, xKey, yChannels);
    const finiteXs = rows.map((r) => xs[r]);
    panels.push({ payload, xRange: [Math.min(...finiteXs), Math.max(...finiteXs)] });
  }
  return panels;
}

/** Union y-domain across every series of a set of break panels — the fixed
 *  `yLim` `MultiPanelStage`'s x-break mode applies to EVERY panel so the
 *  break reads honestly (a real axis break must keep one y-scale; only x is
 *  discontinuous). Null when no panel has any finite y value anywhere. */
export function sharedYDomain(panels: readonly BreakPanel[]): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of panels) {
    for (let s = 1; s < p.payload.data.length; s++) {
      for (const v of p.payload.data[s] as (number | null)[]) {
        if (v == null || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return min <= max ? [min, max] : null;
}
