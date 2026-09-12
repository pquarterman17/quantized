// The "region" tool's optional 2-D y-box (MATLAB `onBGMouseUp` parity, GAP
// #96/#20) — split out of uplotOpts.ts (module-size ratchet: extract a
// cohesive sibling, never raise the pin).
//
// uPlot's OWN drag machinery has no "don't start tracking y until N px"
// concept — verified against uPlot.cjs.js's `updateCursor`: with `dist:0`
// and `uni:1` (uplotOpts.ts's region `cursor.drag`), `dragY` flips true (and
// `u.select.height` becomes the real, sub-`MIN_BOX_HEIGHT_PX` pixel delta)
// the instant the raw vertical offset clears 1px — i.e. on ordinary hand
// jitter during what's meant to be an x-only drag. `MIN_BOX_HEIGHT_PX`
// correctly gates the drag-END pick (uplotOpts.ts's `setSelect` hook reads
// it), but on its own it never gated what got PAINTED while the mouse was
// still moving.
//
// `regionLiveBoxHook` is a `setCursor` hook (fires at the tail of every
// mousemove's `updateCursor`, strictly AFTER uPlot has already repainted
// `.u-select` from that move's fresh, absolute pointer delta) that repaints
// `.u-select` back to the familiar full-plot-height band while the real
// drag is still under the threshold. It touches ONLY the DOM node's own
// style — never `u.setSelect()` — so `u.select.top`/`.height` stay exactly
// what uPlot itself computed: the drag-end `setSelect` hook still reads
// that untouched, real value to decide x-only vs. a genuine box. (Mutating
// `u.select` here instead would make an x-only drag that happens to END
// mid-jitter report a spurious full-height yRange — the last mousemove's
// override would be exactly what `setSelect` reads at mouseup, since mouseup
// itself never recomputes the drag geometry.) Because uPlot recomputes
// `.u-select` fresh from the ABSOLUTE mouse-down/mouse-now positions on
// every move (never incrementally from its own last paint), this hook's
// prior-frame override can never accumulate or go stale — no "restore"
// branch is needed once the real span clears the threshold.
import type uPlot from "uplot";

import type { PlotPayload } from "./plotdata";
import type { PlotTool } from "./uplotOpts";

export const MIN_BOX_HEIGHT_PX = 6; // min vertical px for a deliberate y-box.

/** Which scale ("y" or "y2") the region box's y read-back and y-extent clamp
 *  belong to: the FIT DATA's own axis — `payload.series[0]`, since a
 *  fit/derivative overlay is always appended AFTER it, never in front —
 *  mirroring uplotOverlays.ts's own per-mark `axis===1 && hasY2 ? "y2" :
 *  "y"` resolution rather than hardcoding "y". Today this is "y" at every
 *  real call site (overlays only ever add MORE series on y2, never move
 *  series[0] there), but a dual-Y plot whose sole/primary series is itself
 *  assigned to the secondary axis must read back on its own calibration. */
export function regionYScale(payload: PlotPayload, hasY2: boolean): "y" | "y2" {
  return payload.series[0]?.axis === 1 && hasY2 ? "y2" : "y";
}

/** Build the live-rendering `setCursor` hook described above, closed over
 *  the plot's current tool (a no-op for every tool but "region"). */
export function regionLiveBoxHook(tool: PlotTool): (u: uPlot) => void {
  return (u: uPlot): void => {
    if (tool !== "region") return;
    const sel = u.select;
    if (!sel || sel.width <= 0) return;
    if ((sel.height ?? 0) >= MIN_BOX_HEIGHT_PX) return;
    const band = u.over?.querySelector<HTMLElement>(".u-select");
    if (!band) return;
    band.style.top = "0px";
    band.style.height = `${u.over.clientHeight}px`;
  };
}
