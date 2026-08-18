// P1.5 (PRIMARY_SOFTWARE_AUDIT_PLAN): the live Stage's own group-split
// transform -- makes the Graph Builder's "Group" well durable on the
// INTERACTIVE plot window, not just the builder's own offline preview
// (`lib/plotspec.ts`'s `buildXY`) or the Publication Preview / Figure
// Builder's static export path (`FigureDocument.bindings.groupKey` ->
// `figureSpec.ts` -> the backend's `calc.plotting.build_grouped_series`).
//
// Deliberately a standalone sibling of lib/plotdata.ts, not a new export
// there: plotdata.ts sits at its `architecture.test.ts` TS_MODULE_PINS
// ceiling (ratchet-down-only -- see that file's own header), so a new
// cohesive block funds itself with a fresh module instead of raising the
// pin (the `lib/api/stats.ts` precedent that guard's own comment names).
//
// ALGORITHM PARITY (item 3 of the P1.5 scope; review round P2 correction):
// `applyGroupSplit` is an INDEPENDENTLY hand-written function -- it does
// NOT call `buildXY`, and the two are not one shared code path. What makes
// them a genuine parity claim rather than a hand-synced pair (the exact
// P1.4 "two implementations drift apart" trap) is `plotGroupSplit.test.ts`'s
// REAL runtime parity test: it builds the identical payload through BOTH
// functions and asserts the results are `toEqual` -- same distinct FINITE
// integer codes sorted ascending, same expanded series per (channel,
// level), same `${label} (${groupLabel}=${levelLabel})` format, same
// non-finite-Y masking (both now guard `Number.isFinite` explicitly). That
// test is what would catch the two drifting apart in the future, not a
// shared-code guarantee -- so there is no NEW label-resolution site for the
// backend/frontend cross-language parity fixture
// (`tests/test_calc_plotting.py` <-> `plotspec.test.ts`) to cover: this is
// a frontend-internal parity question between two frontend implementations,
// orthogonal to that fixture's backend/frontend boundary.
//
// STABLE IDENTITY / edit-one-vs-edit-all ruling (item 5): every expanded
// series for one base channel shares that channel's OWN entry in
// seriesStyles/hiddenChannels/seriesOrder/seriesLabels -- there is no
// separate per-level identity. Restyle, hide/show, and legend-click on ANY
// one of a group's levels therefore affects the WHOLE group, matching (a)
// JMP Graph Builder's own default overlay behavior (one style setup per
// grouping variable; per-level color is automatic, not independently
// editable) and (b) this codebase's OWN existing Figure Builder precedent
// (`GroupingPanel.tsx`'s single group-by picker + one `seriesStyles[channel]`
// entry per Y channel, no per-level styling surface). Documented and pinned
// in PRIMARY_SOFTWARE_AUDIT_PLAN.md's P1.5 entry, not re-litigated per call
// site.

import type { PlotPayload, PlotSeriesSpec } from "./plotdata";

/** Distinct finite level count across `groupCodes`. Shared by
 *  `groupSplitChannelMap` (how many display series per real channel) and
 *  `applyGroupSplit` (the level set itself) so both agree on "is there
 *  anything to split on" without the caller computing it twice. */
function levelCount(groupCodes: readonly (number | null | undefined)[]): number {
  return new Set(groupCodes.filter((v): v is number => v != null && Number.isFinite(v))).size;
}

/** The per-DISPLAY-series channel map a grouped render needs: each real
 *  fetched channel repeated once per level (or returned unchanged when
 *  there's nothing to split on). `usePlotPayload.ts` uses this as its
 *  exported `plotted` -- the SAME array `styleList`/`labelList`/`hidden`,
 *  and PlotLegend.tsx/PlotContextMenu.tsx's own direct `plotted[i]`
 *  lookups, key against (P1.5's edit-one/edit-all ruling, see this
 *  module's header). */
export function groupSplitChannelMap(
  fetchChannels: readonly number[],
  groupCodes: readonly (number | null | undefined)[],
): number[] {
  const n = levelCount(groupCodes);
  return n > 0 ? fetchChannels.flatMap((c) => Array<number>(n).fill(c)) : [...fetchChannels];
}

/** Split every Y series in `payload` into one series per level of
 *  `groupCodes` (row-position-aligned to `payload.data`, one code per row --
 *  the caller reads it off the group channel's OWN column, e.g.
 *  `active.data.values.map((row) => row[groupKey])`). Identity (the SAME
 *  `payload`, untouched) when there are no finite group codes to split on --
 *  a channel with every row NaN/missing degrades to ungrouped rather than
 *  emitting zero series. `levelLabelOf` resolves a level's DISPLAY text
 *  (`lib/categorical.ts`'s `groupLevelLabel` is the sanctioned accessor for
 *  it -- P1.5 item 3, never a raw code). */
export function applyGroupSplit(
  payload: PlotPayload,
  groupCodes: readonly (number | null | undefined)[],
  groupLabel: string,
  levelLabelOf: (code: number) => string,
): PlotPayload {
  const levels = [...new Set(groupCodes.filter((v): v is number => v != null && Number.isFinite(v)))].sort(
    (a, b) => a - b,
  );
  if (levels.length === 0) return payload;
  const [x, ...ys] = payload.data as (number | null)[][];
  const cols: (number | null)[][] = [x];
  const series: PlotSeriesSpec[] = [];
  ys.forEach((col, i) => {
    const base = payload.series[i];
    if (!base) return; // defensive: a malformed payload's column/series-list length mismatch
    for (const lvl of levels) {
      // P1.5 review P2: explicit Number.isFinite guard, matching buildXY's
      // own -- the upstream fetch already nulls non-finite values today
      // (buildColumns/fromResponse), so this is usually a no-op in
      // practice, but a caller must never depend on that upstream
      // invariant for genuine parity with buildXY's documented contract.
      cols.push(col.map((v, r) => (groupCodes[r] === lvl && Number.isFinite(v) ? v : null)));
      series.push({ ...base, label: `${base.label} (${groupLabel}=${levelLabelOf(lvl)})` });
    }
  });
  return { ...payload, data: cols as PlotPayload["data"], series };
}
