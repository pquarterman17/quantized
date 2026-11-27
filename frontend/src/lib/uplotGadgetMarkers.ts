// Markers for the curve-measurement gadget kinds, drawn on the plot while the
// gadget is active: a ring at every crossing / intersection / interpolated
// point and a dashed guide at every level (the level of a level-crossing
// search, the low and high reference levels of a rise time). The positions are
// the measurement's own (`measureMarkers`), in data coordinates on the plot's
// primary Y scale; the plugin reads the store's `gadgetMeasure` at draw time
// and redraws when it changes, so no prop is threaded through the stage.
// Loaded with the gadget plugins (lib/uplotGadgets.ts), never eagerly.

import type uPlot from "uplot";

import { useApp } from "../store/useApp";
import { measureMarkers, type GadgetMeasure } from "./gadgetMeasure";

interface MarkerSource {
  get: () => GadgetMeasure | null;
  /** Calls back on every change; returns the unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
}

const STORE_SOURCE: MarkerSource = {
  get: () => useApp.getState().gadgetMeasure,
  subscribe: (onChange) => useApp.subscribe((s, prev) => { if (s.gadgetMeasure !== prev.gadgetMeasure) onChange(); }),
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
          const py = u.valToPos(level, "y", true);
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
          const py = u.valToPos(p.y, "y", true);
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
