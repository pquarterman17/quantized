// The facet / x-break helpers only lazy modules call, split out of
// `lib/facet.ts` (bundle diet slice 20, plans/BUNDLE_HEADROOM.md). The eager
// graph needs facet.ts for the store's facet/break gestures and the durable
// composition; these four serve the multi-panel stage, the encoded facet grid,
// the Stat Stage, the Graph Builder preview and the export. Import them from
// this path, never re-exported through facet.ts: a re-export keeps them in
// facet's eager chunk (slice 18).

import type { BreakPanel, FacetPanel, FacetSlice } from "./facet";
import { defaultDenseChannels } from "./plotdata";
import type { DataStruct } from "./types";

/** A facet slice's points' ORIGINAL dataset rows: `slice.rows[j]` composed
 *  with `rowIds` (`lib/rowstate.analysisRowIds`/`analysisView(ds).rowIds`),
 *  the SAME composition every faceted `IndexedGroupSpec` must use if it is
 *  ever built (`slice.rows` maps a slice-local position back to its row in
 *  the `data` `facetSlices` was called on; `rowIds` then maps THAT back to
 *  the true original row, when `data` was itself the analysis view). Pass
 *  `rowIds` as `null` when `data` IS the dataset (nothing dropped) — the
 *  same "identity means no drop" convention `resolveGroupsIndexed` uses, so
 *  the result is exactly `slice.rows` unchanged.
 *
 *  The ONE production entry point for this composition, wherever a caller
 *  resolves points PER FACET SLICE rather than for the flat dataset — so a
 *  faceted points overlay cannot reinvent its own row math and drift from
 *  the flat panel's. Callers (JMP_GAP J5 residual, closed 2026-09-29):
 *  `Stage/useStatStageCompute.computeFacetGroupDraws` (box / violin / strip
 *  points, via `statstage.resolveGroupsIndexed`'s `rowIds`),
 *  `computeFacetBarDraws` (bar cells' raw points, via `statBarMarks.
 *  barCellPoints`) and the Graph Builder preview's marks
 *  (`workshops/graphbuilder/previewMarks`). */
export function facetSliceRowIds(slice: FacetSlice, rowIds: readonly number[] | null): number[] {
  return rowIds ? slice.rows.map((r) => rowIds[r] ?? r) : [...slice.rows];
}

/** The Y channels an ENCODED or GROUPED facet grid splits — the SAME list in
 *  every panel, which the split needs (one style per series across panels;
 *  the backend refuses panels that disagree). Explicit `yKeys` when set;
 *  otherwise the FLAT plot's own default over the whole (analysis) `data`
 *  (`defaultDenseChannels`), never the per-panel default `facetPayloads`
 *  resolves for an unencoded grid, which can differ panel to panel
 *  (FEATURE-001). Null when even that default names no channel — the grid
 *  then draws unencoded, and the Graph Builder says why in one sentence
 *  (`graphbuilder/encodingWellModel.FACET_NO_Y_NOTE`). Shared by the Stage
 *  (`Stage/useFacetEncoding`) and the export (`figureSpec.ts`), so the two
 *  cannot disagree about which channels an encoded grid draws. */
export function facetSplitChannels(
  data: DataStruct,
  xKey: number | null,
  yKeys: readonly number[] | null | undefined,
): number[] | null {
  const channels = yKeys && yKeys.length > 0 ? [...yKeys] : defaultDenseChannels(data, xKey);
  return channels.length > 0 ? channels : null;
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

/** Union y-domain across every series of a set of break panels — the fixed
 *  `yLim` `MultiPanelStage`'s x-break mode applies to EVERY panel so the
 *  break reads honestly (a real axis break must keep one y-scale; only x is
 *  discontinuous). Null when no panel has any finite y value anywhere.
 *  Series of a `hidden` channel are skipped: the export drops them before
 *  matplotlib autoscales, so counting them would stretch only the screen. */
export function sharedYDomain(
  panels: readonly BreakPanel[],
  hidden: readonly number[] = [],
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of panels) {
    for (let s = 1; s < p.payload.data.length; s++) {
      if (hidden.includes(p.channels[s - 1])) continue;
      for (const v of p.payload.data[s] as (number | null)[]) {
        if (v == null || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return min <= max ? [min, max] : null;
}
