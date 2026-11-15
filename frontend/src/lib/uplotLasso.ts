// The Lasso Mask tool (gap audit 4 G19): drag a free-form outline around
// points; on release the enclosed points are masked (Shift: unmasked) as ONE
// undo step by the caller (`Stage/usePlotStageActions.ts` ->
// `lib/plotPointMask.lassoRows`). Only the outline lives here: it is drawn in
// css px over the plotting area and handed back in the same px, so the hit
// test runs in screen space on each point's own axis (a Y2 curve, a loop
// whose X runs back on itself). Part of the lazy tool-plugin chunk
// (`lib/uplotToolPlugins.ts`).

import type uPlot from "uplot";

import { setActiveGestureCancel } from "./gestureCancel";

/** Outline points closer than this (css px) are not recorded. */
const STEP_PX = 3;

export type LassoHandler = (u: uPlot, poly: [number, number][], unmask: boolean) => void;

export function lassoPlugin(onLasso: LassoHandler, color: string): uPlot.Plugin {
  let poly: [number, number][] = [];
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        over.style.cursor = "crosshair";
        over.addEventListener("mousedown", (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const rect = over.getBoundingClientRect();
          const at = (ev: MouseEvent): [number, number] => [ev.clientX - rect.left, ev.clientY - rect.top];
          poly = [at(e)];
          const onMove = (ev: MouseEvent) => {
            const p = at(ev);
            const last = poly[poly.length - 1];
            if (Math.hypot(p[0] - last[0], p[1] - last[1]) < STEP_PX) return;
            poly.push(p);
            u.redraw(false);
          };
          const stop = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            setActiveGestureCancel(null);
          };
          const onUp = (ev: MouseEvent) => {
            stop();
            const done = poly;
            poly = [];
            u.redraw(false);
            if (done.length >= 3) onLasso(u, done, ev.shiftKey);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          // Escape / right-click: drop the outline, mask nothing.
          setActiveGestureCancel(() => {
            stop();
            poly = [];
            u.redraw(false);
          });
        });
      },
      draw: (u: uPlot) => {
        if (poly.length < 2) return;
        const { ctx } = u;
        const pr = devicePixelRatio || 1;
        const { left, top } = u.bbox;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * pr;
        ctx.setLineDash([4 * pr, 3 * pr]);
        ctx.beginPath();
        poly.forEach(([x, y], i) => (i ? ctx.lineTo(left + x * pr, top + y * pr) : ctx.moveTo(left + x * pr, top + y * pr)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      },
    },
  };
}
