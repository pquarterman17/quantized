// On-plot markers for the Pick tool's collected points (gap plan item 22).
// They are DOM nodes over the plotting area, not canvas pixels: they stay while
// the picked list exists (whatever tool is armed), clear with it, and never
// reach "Save PNG" or the snapshot, which read the canvas. Part of the lazy
// tool-plugin chunk (`lib/uplotToolPlugins.ts`).

import type uPlot from "uplot";

import { usePickedPoints } from "../store/pickedPoints";
import { useApp } from "../store/useApp";

const SIZE = 14;

/** Is anything picked (so a chart built under another tool must still show the markers)? */
export const hasPicks = (): boolean => usePickedPoints.getState().points.length > 0;

export function pickMarksPlugin(): uPlot.Plugin {
  let layer: HTMLDivElement | null = null;
  let off = () => {};
  const paint = (u: uPlot) => {
    const graph = useApp.getState().activeId;
    const mine = usePickedPoints.getState().points.flatMap((p, i) => (p.mark && p.mark.graphId === graph ? [{ m: p.mark, n: i + 1 }] : []));
    const marks = mine.length && u.scales.x.ori !== 1 ? mine : []; // a turned plot draws none (Pick is off there)
    if (!layer && marks.length === 0) return;
    if (!layer) {
      layer = document.createElement("div");
      layer.setAttribute("data-pick-marks", "");
      layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
      u.over.appendChild(layer);
    }
    layer.replaceChildren();
    const [w, h] = [u.over.clientWidth, u.over.clientHeight];
    for (const { m, n } of marks) {
      const [x, y] = [u.valToPos(m.x, "x", false), u.valToPos(m.y, u.scales[m.scale] ? m.scale : "y", false)];
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > w || y > h) continue;
      const el = document.createElement("span");
      el.textContent = String(n);
      el.setAttribute("data-pick-mark", String(n));
      el.style.cssText = `position:absolute;left:${x - SIZE / 2}px;top:${y - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;box-sizing:border-box;border:2px solid var(--accent,#8b5cf6);border-radius:50%;font:700 9px/10px sans-serif;text-align:center;color:var(--accent,#8b5cf6)`;
      layer.appendChild(el);
    }
  };
  return {
    hooks: {
      ready: (u: uPlot) => {
        off = usePickedPoints.subscribe(() => paint(u));
        paint(u);
      },
      draw: paint,
      destroy: () => {
        off();
        layer?.remove();
        layer = null;
      },
    },
  };
}
