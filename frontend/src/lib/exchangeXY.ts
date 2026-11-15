// Plot > "Exchange X-Y axes" (Origin's command of the same name): the graph
// turns on its side -- X up the left, Y along the bottom -- with every axis
// keeping its own title, units, scale, limits, direction and tick format. The
// toggle is `PlotView.exchangeXY`; the screen turns the layer through uPlot's
// scale orientation (lib/uplotOrient.ts, shared with horizontal bars) and the
// export through calc/figure_orient.py (`overrides.exchange_xy`).
//
// Only the flat X-Y plot can be exchanged. Maps, polar and statistics plots,
// stacked / faceted / broken layouts and the magnifier inset have their own
// renderers (or, for the inset, a plot that does not turn), so the command is
// DISABLED with the reason there rather than drawing a half-turned figure.

import type { AxisFormat } from "./types";

export interface ExchangeState {
  exchangeXY: boolean;
  stageTab: string;
  polarMode: boolean;
  statMode: boolean;
  stackMode: boolean;
  insetMode: boolean;
  facetKey: number | null;
  composition: unknown;
  yFmt: AxisFormat;
  y2Fmt: AxisFormat | null;
}

/** Why the view cannot be exchanged (the disabled reason), or undefined when it can. An already exchanged view can always be turned back. */
export function exchangeBlocker(s: ExchangeState): string | undefined {
  if (s.exchangeXY) return undefined;
  const what =
    s.stageTab === "map" ? "maps"
    : s.polarMode ? "polar plots"
    : s.statMode ? "statistics plots"
    : s.stackMode || s.facetKey != null || s.composition ? "multi-panel layouts"
    : s.yFmt.breaks?.length || s.y2Fmt?.breaks?.length ? "broken axes"
    : s.insetMode ? "insets"
    : "";
  return what ? `Not available for ${what}` : undefined;
}
