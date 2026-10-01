// The style a series is DRAWN with, for the pickers that show it (the
// Inspector's "Series style" card and the plot's curve context menu) —
// PRIMARY_SOFTWARE_AUDIT_PLAN P3.3. With the opt-in auto dash/marker cycle on,
// an unstyled series has no stored `line`/`markerShape`, so a picker that shows
// the STORED value read "solid"/"circle" while the canvas drew a cycled dash or
// glyph.
//
// No cycle logic lives here: this is the canvas' own call —
// `resolveSeriesStyle(style, i, displayPositions(on, plotted.length))`, as
// `PlotViewport` (via `useStageSeriesCycle`) makes it — plus which fields the
// cycle supplied, so a picker can mark them "(auto)". Choosing a value still
// stores it explicitly, and an explicit value always wins over the cycle.

import { displayPositions, resolveSeriesStyle } from "./seriesStyleCycle";
import type { SeriesStyle } from "./types";

export interface DrawnSeriesStyle {
  /** The effective style (the stored one when nothing cycles). */
  style: SeriesStyle;
  /** `style.line` came from the cycle, not the user. */
  autoLine: boolean;
  /** `style.markerShape` came from the cycle, not the user. */
  autoMarkerShape: boolean;
}

/**
 * @param stored the per-channel stored style (possibly undefined).
 * @param index the series' position in the canvas' plotted list, or -1 when
 *   the canvas does not draw it.
 * @param count the length of that plotted list.
 * @param on `windowCyclesSeriesStyles` for the window drawing it
 *   (`useStageSeriesCycle.selectFocusedWindowCycles` for the focused one).
 */
export function drawnSeriesStyle(
  stored: SeriesStyle | undefined,
  index: number,
  count: number,
  on: boolean,
): DrawnSeriesStyle {
  const style = resolveSeriesStyle(stored, index, displayPositions(on, count)) ?? {};
  return {
    style,
    autoLine: stored?.line === undefined && style.line !== undefined,
    autoMarkerShape: stored?.markerShape === undefined && style.markerShape !== undefined,
  };
}
