// The P3.3 auto dash/marker cycle on a paneled x-break (S1 b).
//
// A break view EXPORTS as the flat figure plus `x_breaks`
// (`lib/figureSpec.ts`), and `windowCyclesSeriesStyles` lets that export cycle
// whenever the flat overlay would — a saved break mounts its panels with
// `stackMode` off (BUG-012), which the gate does not refuse. The panels used to
// pass no cycle at all, so the PDF dashed curves the screen drew solid.
//
// The screen side was the wrong one: matplotlib draws each series once per
// x-segment with ONE style, so the export reproduces the flat display list
// series-for-series and its dash is a faithful answer. The panels therefore
// resolve the SAME cycle — but keyed by CHANNEL, at each channel's slot in the
// flat canvas list (`effectiveChannels`, the call `usePlotPayload` and
// `figureSpecSeries.resolveDisplaySeries` both make), because a break panel
// resolves its channels over its own x-slice and two panels can hold different
// ones. The result is a channel-keyed style map, the shape the break leg
// already projects through `BreakPanel.channels` (`breakPanelRender.ts`).
//
// Returns `undefined` — "use the raw styles" — for every other arrangement and
// whenever the window does not cycle, so the stack, facet and spatial legs are
// untouched.

import { useMemo } from "react";

import { breakPanelsOf, type Composition } from "../../lib/composition";
import type { FigureDocument } from "../../lib/figureDocument";
import { effectiveChannels } from "../../lib/plotdata";
import {
  displayPositions,
  resolveSeriesStyle,
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

/** `styles` with every channel of the flat canvas list `channels` resolved
 *  through the cycle at its display position (first occurrence wins). */
export function cycledChannelStyles(
  styles: Record<number, SeriesStyle>,
  channels: readonly number[],
): Record<number, SeriesStyle> {
  const positions = displayPositions(true, channels.length);
  const out = { ...styles };
  const seen = new Set<number>();
  channels.forEach((ch, i) => {
    if (seen.has(ch)) return;
    seen.add(ch);
    const st = resolveSeriesStyle(styles[ch], i, positions);
    if (st) out[ch] = st;
  });
  return out;
}

export function useBreakSeriesStyles(
  cycles: boolean,
  composition: Composition | null,
  dataset: Dataset | null,
  v: { xKey: number | null; yKeys: number[] | null; seriesOrder: number[] | null; seriesStyles: Record<number, SeriesStyle> },
): Record<number, SeriesStyle> | undefined {
  const on = cycles && dataset !== null && breakPanelsOf(composition) !== null;
  const { xKey, yKeys, seriesOrder, seriesStyles } = v;
  return useMemo(
    () =>
      on && dataset
        ? cycledChannelStyles(
            seriesStyles,
            effectiveChannels(dataset.data, yKeys, xKey, dataset.channelRoles, seriesOrder),
          )
        : undefined,
    [on, dataset, xKey, yKeys, seriesOrder, seriesStyles],
  );
}
