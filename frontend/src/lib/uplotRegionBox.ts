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
 *  belong to. THE RULE (keep `usePlotStageActions.ts`'s `plottedYExtent` in
 *  sync with this — same rule, same series, or the read-back and the clamp
 *  silently disagree): the PRIMARY axis (`axis !== 1`) is the region's
 *  target whenever ANY plotted series is primary; only when EVERY plotted
 *  series sits on the secondary axis does the box belong to "y2".
 *
 *  Round-2 finding: this used to key off `payload.series[0]` alone, on the
 *  premise that a fit/derivative overlay is always appended AFTER the fit
 *  data it describes (true for `uplotOverlays.ts`'s own marks/shades). That
 *  premise does not hold for the ordinary dual-Y feature — `plotdata.ts`'s
 *  `buildColumns`/`y2Keys` lets a user toggle ANY plotted channel onto the
 *  secondary axis, including the FIRST one, with no reordering — so
 *  `series[0]` can be the Y2 channel while the primary channel actually
 *  being boxed sits at `series[1]`. Resolving off "is there a primary
 *  series at all" instead of "is series[0] primary" is correct regardless of
 *  which index the user happened to toggle. */
export function regionYScale(payload: PlotPayload, hasY2: boolean): "y" | "y2" {
  if (!hasY2) return "y";
  return payload.series.some((s) => (s.axis ?? 0) !== 1) ? "y" : "y2";
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

/** The region tool's drag-END pick (the app's own `setSelect` hook, called
 *  by uPlot's `mouseUp` after IT has already restyled `.u-select` from the
 *  real, untouched drag geometry — see `regionLiveBoxHook`'s doc for why
 *  that geometry must stay untouched during the drag). Reads x0/x1 always;
 *  y0/y1 too once the real span clears `MIN_BOX_HEIGHT_PX`, on `regionYScale`.
 *
 *  Round-2 finding 2: uPlot's `mouseUp` (`uPlot.cjs.js` ~5834-5889) calls
 *  `setSelect(select)` UNCONDITIONALLY whenever the select changed — with no
 *  `_fire` argument, so it re-fires this very hook — and only calls its own
 *  `hideSelect()` inside the `if (drag.setScale && …)` branch. The region
 *  tool sets `cursor.drag.setScale: false` (so a 2-D drag never rescales an
 *  axis), which means that branch — and `hideSelect()` — never runs for
 *  region at all. Left alone, a sub-threshold (x-only) drag ends with the
 *  real, few-px `.u-select` sliver `regionLiveBoxHook` was overriding still
 *  painted, visible until the next tool change tears down and rebuilds the
 *  uPlot instance. Hiding it HERE, synchronously, in the same tick as the
 *  pick, closes that gap: `u.setSelect({..0 rect..}, false)` is the EXACT
 *  call uPlot's own `hideSelect()` makes internally (verified against its
 *  `_hideProps`/`hideSelect` source), and passing `_fire: false` is what
 *  stops it from re-invoking this hook — `setSelect`'s body only calls
 *  `fire("setSelect")` when `_fire !== false`, so there is no re-entrancy to
 *  guard against. */
export function regionSelectPick(
  u: uPlot,
  payload: PlotPayload,
  hasY2: boolean,
  onRegionSelect: (x0: number, x1: number, y0?: number, y1?: number) => void,
): void {
  const x0 = u.posToVal(u.select.left, "x");
  const x1 = u.posToVal(u.select.left + u.select.width, "x");
  const h = u.select.height ?? 0;
  if (h < MIN_BOX_HEIGHT_PX) {
    onRegionSelect(x0, x1);
  } else {
    const scale = regionYScale(payload, hasY2);
    const top = u.select.top ?? 0;
    onRegionSelect(x0, x1, u.posToVal(top, scale), u.posToVal(top + h, scale));
  }
  u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
}
