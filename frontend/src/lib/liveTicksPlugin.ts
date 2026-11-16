// The focused stage canvas' publisher for `lib/liveTickSteps.ts`: after each
// draw, the increment of the ticks uPlot drew on x, y and y2, keyed by the
// focused plot window (the focused stage always draws it). Cleared when the plot
// is destroyed, so a closed or rebuilt plot leaves no stale increments.

import type uPlot from "uplot";

import { drawnIncrement, publishLiveTickSteps } from "./liveTickSteps";
import { useApp } from "../store/useApp";

type DrawnAxis = uPlot.Axis & { _splits?: (number | null)[] };

export function liveTicksPlugin(): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        // uPlot's axis defaults name the scales: "x" on the first, "y" on the second.
        const at = (k: string) => drawnIncrement((u.axes as DrawnAxis[]).find((a) => a.scale === k)?._splits);
        publishLiveTickSteps({ windowId: useApp.getState().focusedWindowId, x: at("x"), y: at("y"), y2: at("y2") });
      },
      destroy: () => publishLiveTickSteps(null),
    },
  };
}
