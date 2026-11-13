// F2.3b per-series edits for a canonical Publication preview draft --
// colour/width/mode, visibility and draw order. Moved verbatim out of
// useFigureBuilder.ts (its module-size pin) to fund the canonical graph
// template wiring (figures-audit B2); behaviour unchanged.
//
// These are genuinely canonical PlotView fields (seriesStyles/hiddenChannels/
// seriesOrder) with no FigureOverrides equivalent, so every edit writes
// straight through `setView` (the hook's setCanonicalView).

import type { FigureViewState } from "../../../lib/figureDocument";
import type { PlotView } from "../../../lib/plotview";
import type { SeriesStyle } from "../../../lib/types";

export interface CanonicalSeriesOps {
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
  setSeriesHidden: (channel: number, hidden: boolean) => void;
  moveSeries: (channel: number, direction: -1 | 1) => void;
}

export function canonicalSeriesOps(
  view: PlotView | null,
  seriesChannels: readonly number[],
  setView: (patch: Partial<FigureViewState>) => void,
): CanonicalSeriesOps {
  const setSeriesStyle = (channel: number, patch: Partial<SeriesStyle>) =>
    setView({
      seriesStyles: {
        ...view?.seriesStyles,
        [channel]: { ...view?.seriesStyles?.[channel], ...patch },
      },
    });
  const setSeriesHidden = (channel: number, hidden: boolean) => {
    const current = view?.hiddenChannels ?? [];
    setView({
      hiddenChannels: hidden
        ? (current.includes(channel) ? current : [...current, channel])
        : current.filter((c) => c !== channel),
    });
  };
  const moveSeries = (channel: number, direction: -1 | 1) => {
    const order = [...seriesChannels];
    const index = order.indexOf(channel);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setView({ seriesOrder: order });
  };
  return { setSeriesStyle, setSeriesHidden, moveSeries };
}
