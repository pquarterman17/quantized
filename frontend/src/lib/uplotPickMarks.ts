// On-plot markers for the Pick tool's collected points (gap plan item 22).
// They are DOM nodes over the plotting area, not canvas pixels: they stay while
// the picked list exists (whatever tool is armed), clear with it, and never
// reach "Save PNG" or the snapshot, which read the canvas. Part of the lazy
// tool-plugin chunk (`lib/uplotToolPlugins.ts`).

import type uPlot from "uplot";

import { keyPalette } from "./plotKeyPalette";
import { usePickedPoints } from "../store/pickedPoints";
import { useApp } from "../store/useApp";
import { dataToPx } from "./uplotPointerPx";
import type { RawPixelPlugin } from "./uplotPointer";

/** Ring diameter (px): big enough that a two-digit number fits inside at a readable size. */
export const PICK_MARK_SIZE = 20;
const SIZE = PICK_MARK_SIZE;

/** Is anything picked (so a chart built under another tool must still show the markers)? */
export const hasPicks = (): boolean => usePickedPoints.getState().points.length > 0;

export function pickMarksPlugin(): RawPixelPlugin {
  let layer: HTMLDivElement | null = null;
  let off = () => {};
  const paint = (u: uPlot) => {
    const graph = useApp.getState().activeId;
    const mine = usePickedPoints.getState().points.flatMap((p, i) => (p.mark && p.mark.graphId === graph ? [{ m: p.mark, n: i + 1 }] : []));
    const marks = mine;
    if (!layer && marks.length === 0) return;
    if (!layer) {
      layer = document.createElement("div");
      layer.setAttribute("data-pick-marks", "");
      layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
      u.over.appendChild(layer);
    }
    layer.replaceChildren();
    const [w, h] = [u.over.clientWidth, u.over.clientHeight];
    // The number reads in the plot's own ink over a halo of the plot's own background (the ring gets the same
    // halo outside it), so it is legible on a light or a dark plot and where the ring crosses a curve.
    const { bg, ink } = keyPalette(u);
    const halo = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].map(([dx, dy]) => `${dx}px ${dy}px 0 ${bg}`).join(",");
    for (const { m, n } of marks) {
      if (!u.scales[m.scale]) continue; // the curve's own axis is gone: never draw it against another
      const [x, y] = dataToPx(u, m.x, m.y, m.scale);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > w || y > h) continue;
      const el = document.createElement("span");
      el.textContent = String(n);
      el.setAttribute("data-pick-mark", String(n));
      el.style.cssText = `position:absolute;left:${x - SIZE / 2}px;top:${y - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;box-sizing:border-box;border:2.5px solid var(--accent,#8b5cf6);border-radius:50%;box-shadow:0 0 0 1.5px ${bg};font:700 11px/${SIZE - 5}px sans-serif;text-align:center;color:${ink};text-shadow:${halo}`;
      layer.appendChild(el);
    }
  };
  return {
    rawPixels: true,
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
