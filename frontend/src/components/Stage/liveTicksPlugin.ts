// The focused stage canvas' publisher for `lib/liveTickSteps.ts`: after each
// draw, the increment of the ticks uPlot drew on x, y and y2, keyed by the
// active dataset (the focused stage always shows it). Cleared when the plot
// is destroyed, so a closed or rebuilt plot leaves no stale increments.

import type uPlot from "uplot";

import { drawnIncrement, publishLiveTickSteps } from "../../lib/liveTickSteps";
import { useApp } from "../../store/useApp";

type DrawnAxis = uPlot.Axis & { _splits?: (number | null)[] };

export function liveTicksPlugin(): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const axes = u.axes as DrawnAxis[];
        const at = (scale: string) => axes.find((a) => (a.scale ?? "") === scale);
        publishLiveTickSteps({
          datasetId: useApp.getState().activeId,
          x: drawnIncrement(axes[0]?._splits),
          y: drawnIncrement((at("y") ?? axes[1])?._splits),
          y2: drawnIncrement(at("y2")?._splits),
        });
      },
      destroy: () => publishLiveTickSteps(null),
    },
  };
}
