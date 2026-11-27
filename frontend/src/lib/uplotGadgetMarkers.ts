// Markers for the curve-measurement gadget kinds, drawn on the plot while the
// gadget is active: a ring at every crossing / intersection / interpolated
// point and a dashed guide at every level (the level of a level-crossing
// search, the low and high reference levels of a rise time). The positions are
// the measurement's own (`measureMarkers`), in data coordinates, each on the Y
// scale of the curve it was measured on (`placeCurve`: Y1, Y2, Y3+), and hidden
// where that cannot be placed truthfully (a turned plot, a waterfall); the plugin
// reads the store's `gadgetMeasure` at draw time and redraws when it changes, so no
// prop is threaded through the stage.
// Loaded with the gadget plugins (lib/uplotGadgets.ts), never eagerly.

import type uPlot from "uplot";

import { useApp } from "../store/useApp";
import { measureMarkers, type GadgetMeasure } from "./gadgetMeasure";
import { placeCurve, type Placement } from "./gadgetMarkerPlace";

interface MarkerSource {
  get: () => GadgetMeasure | null;
  /** Calls back on every change; returns the unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
  /** The scale curve `yKey` is drawn on in `u`, or why it cannot be placed. */
  place: (u: uPlot, yKey: number) => Placement;
}

const STORE_SOURCE: MarkerSource = {
  get: () => useApp.getState().gadgetMeasure,
  subscribe: (onChange) => useApp.subscribe((s, prev) => { if (s.gadgetMeasure !== prev.gadgetMeasure) onChange(); }),
  place: (u, yKey) => placeCurve(u, useApp.getState(), yKey),
};

export function gadgetMarkersPlugin(color: string, source: MarkerSource = STORE_SOURCE): uPlot.Plugin {
  let unsubscribe: (() => void) | null = null;
  return {
    hooks: {
      ready: (u: uPlot) => {
        unsubscribe = source.subscribe(() => u.redraw(false));
      },
      destroy: () => unsubscribe?.(),
      draw: (u: uPlot) => {
        const { points, levels } = measureMarkers(source.get());
        if (points.length === 0 && levels.length === 0) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const ratio = window.devicePixelRatio || 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 * ratio;
        ctx.setLineDash([4 * ratio, 3 * ratio]);
        for (const level of levels) {
          const at = source.place(u, level.yKey);
          const py = "scale" in at ? u.valToPos(level.y, at.scale, true) : NaN;
          if (!Number.isFinite(py)) continue;
          ctx.beginPath();
          ctx.moveTo(left, py);
          ctx.lineTo(left + width, py);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineWidth = 2 * ratio;
        for (const p of points) {
          const px = u.valToPos(p.x, "x", true);
          const at = source.place(u, p.yKey);
          const py = "scale" in at ? u.valToPos(p.y, at.scale, true) : NaN; // hidden, never drawn on another scale
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          ctx.beginPath();
          ctx.arc(px, py, 5 * ratio, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}
