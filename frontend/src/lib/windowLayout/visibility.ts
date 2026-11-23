// Keeping a newly opened window in sight (UX pass 2, M1). Floating windows sit
// above every docked one, so a window that opens DOCKED under a floating plot
// that covers its slot is invisible. Pure geometry; the callers read the DOM
// and the store.

import type { Slot } from "./types";

export type Edge = "left" | "right" | "bottom";

/** An edge's size before the user drags its splitter (the mockup's sizes; the
 *  bottom is taller than the mockup's 240 so a docked plot keeps a usable plot
 *  area under its title bar and toolbar). */
export const DEFAULT_EDGE: Readonly<Record<Edge, number>> = { left: 320, right: 380, bottom: 320 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A floating Style or Data window's default width, and its gap to the desk edge (FloatLayer). */
export const TOOL_W = 360;
export const EDGE_GAP = 16;

/** The desk region a window docked to `slot` would occupy (`px` = the edge's size). */
export function slotBox(slot: Slot, px: number, desk: { width: number; height: number }): Box {
  if (slot === "left") return { x: 0, y: 0, w: px, h: desk.height };
  if (slot === "right") return { x: desk.width - px, y: 0, w: px, h: desk.height };
  if (slot === "bottom") return { x: 0, y: desk.height - px, w: desk.width, h: px };
  return { x: 0, y: 0, w: desk.width, h: desk.height };
}

/** A first-opened floating Style, Data, Analysis or tool window starts this far below the desk top, so it
 *  clears a plot window's title bar (and its dock and close buttons) instead of covering them (UX pass 3, M1). */
export const PLOT_BAR_CLEAR = 36;

/** The share of a docked slot that must stay uncovered for the window in it to count as in sight. */
const MIN_VISIBLE_SHARE = 0.25;

/** Do the floating boxes TOGETHER hide the slot (all but a sliver of it)? Floating windows sit above every
 *  docked one, so a window docked into a region they cover is out of sight (UX pass 2 M1, pass 3 B2). Exact:
 *  the uncovered area of the region, by the union of the boxes, against MIN_VISIBLE_SHARE of it. */
export function slotHidden(region: Box, floats: readonly Box[]): boolean {
  const area = region.w * region.h;
  if (area <= 0) return false;
  const clip = floats
    .map((f) => ({ x0: Math.max(f.x, region.x), y0: Math.max(f.y, region.y), x1: Math.min(f.x + f.w, region.x + region.w), y1: Math.min(f.y + f.h, region.y + region.h) }))
    .filter((f) => f.x1 > f.x0 && f.y1 > f.y0);
  const xs = [...new Set([region.x, region.x + region.w, ...clip.flatMap((f) => [f.x0, f.x1])])].sort((a, b) => a - b);
  let covered = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const [a, b] = [xs[i], xs[i + 1]];
    const spans = clip.filter((f) => f.x0 <= a && f.x1 >= b).map((f) => [f.y0, f.y1] as const).sort((p, q) => p[0] - q[0]);
    let top = region.y;
    for (const [y0, y1] of spans) {
      if (y1 > top) {
        covered += (b - a) * (y1 - Math.max(y0, top));
        top = y1;
      }
    }
  }
  return area - covered < area * MIN_VISIBLE_SHARE;
}
