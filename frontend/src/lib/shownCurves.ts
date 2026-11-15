// The channels a plot actually DRAWS (the plotted Ys minus the hidden ones),
// in draw order. One definition for the canvas (usePerSeriesX,
// useMultiPanelStage) and the figure export (figureSpecPerSeriesX), so the
// per-series-X blocks they derive from it cannot disagree -- the export once
// omitted `seriesOrder`.

import { effectiveChannels } from "./plotdata";
import type { Dataset, DataStruct } from "./types";

export function shownCurves(
  data: DataStruct,
  view: {
    yKeys: number[] | null;
    xKey: number | null;
    seriesOrder: number[] | null;
    hiddenChannels: readonly number[];
  },
  channelRoles?: Dataset["channelRoles"],
): number[] {
  return effectiveChannels(data, view.yKeys, view.xKey, channelRoles, view.seriesOrder).filter(
    (c) => !view.hiddenChannels.includes(c),
  );
}
