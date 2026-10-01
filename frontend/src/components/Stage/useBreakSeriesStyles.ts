// What a paneled x-break draws with, per CHANNEL: the palette slot (T2) and the
// P3.3 auto dash/marker cycle (S1 b).
//
// A break view EXPORTS as the flat figure plus `x_breaks` (`lib/figureSpec.ts`),
// which colours every series once by its slot in the flat canvas list
// (BUG-015's positions — a hidden series keeps its slot) and, whenever
// `windowCyclesSeriesStyles` lets the flat overlay cycle, dashes it at that same
// slot. A saved break mounts its panels with `stackMode` off (BUG-012), which
// that gate does not refuse. The panels used to colour by their OWN series
// index and pass no cycle, so a panel holding [B, C] drew B in `--series-1`, and
// solid, where the PDF drew it in `--series-2`, dashed.
//
// The screen side was the wrong one: matplotlib draws each series once per
// x-segment with ONE style, so the export reproduces the flat display list
// series-for-series. The panels therefore resolve the SAME slot — keyed by
// CHANNEL, at each channel's position in the flat canvas list
// (`effectiveChannels`, the call `usePlotPayload` and
// `figureSpecSeries.resolveDisplaySeries` both make), because a break panel
// resolves its channels over its own x-slice and two panels can hold different
// ones. The slot rides as a `--series-N` TOKEN colour (re-themeable, resolved by
// `seriesColor`), filled in only where the channel has no explicit colour. The
// result is a channel-keyed style map, the shape the break leg already projects
// through `BreakPanel.channels` (`breakPanelRender.ts`).
//
// Returns `undefined` — "use the raw styles" — for every other arrangement, so
// the stack, facet and spatial legs are untouched.

import { useMemo } from "react";

import { breakPanelsOf, type Composition } from "../../lib/composition";
import type { FigureDocument } from "../../lib/figureDocument";
import { effectiveChannels } from "../../lib/plotdata";
import {
  displayPositions,
  resolveSeriesStyle,
  SERIES_VARS,
  windowCyclesSeriesStyles,
  type CycleView,
} from "../../lib/seriesStyleCycle";
import type { Dataset, SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";

/** Does the plot window drawing `view` (with `doc` behind it) cycle? The same
 *  `windowCyclesSeriesStyles` call `useStageSeriesCycle.useWindowSeriesCycle`
 *  makes, as a boolean — for a BACKGROUND window's break panels. Lives here,
 *  not beside it, so the eager bundle does not carry it. */
export function useWindowCycles(view: CycleView, doc: FigureDocument | undefined): boolean {
  return windowCyclesSeriesStyles(useApp((s) => s.autoSeriesStyles), view, doc);
}

/** `styles` with every channel of the flat canvas list `channels` given its
 *  palette slot there (unless it has an explicit colour) and, when `cycle`, the
 *  dash/marker cycle at that position. First occurrence wins. */
export function breakChannelStyles(
  styles: Record<number, SeriesStyle>,
  channels: readonly number[],
  cycle: boolean,
): Record<number, SeriesStyle> {
  const positions = displayPositions(cycle, channels.length);
  const out = { ...styles };
  const seen = new Set<number>();
  channels.forEach((ch, i) => {
    if (seen.has(ch)) return;
    seen.add(ch);
    const st = resolveSeriesStyle(styles[ch], i, positions);
    out[ch] = { ...st, color: st?.color || SERIES_VARS[i % SERIES_VARS.length] };
  });
  return out;
}

export function useBreakSeriesStyles(
  cycles: boolean,
  composition: Composition | null,
  dataset: Dataset | null,
  v: { xKey: number | null; yKeys: number[] | null; seriesOrder: number[] | null; seriesStyles: Record<number, SeriesStyle> },
): Record<number, SeriesStyle> | undefined {
  const on = dataset !== null && breakPanelsOf(composition) !== null;
  const { xKey, yKeys, seriesOrder, seriesStyles } = v;
  return useMemo(
    () =>
      on && dataset
        ? breakChannelStyles(
            seriesStyles,
            effectiveChannels(dataset.data, yKeys, xKey, dataset.channelRoles, seriesOrder),
            cycles,
          )
        : undefined,
    [on, cycles, dataset, xKey, yKeys, seriesOrder, seriesStyles],
  );
}
