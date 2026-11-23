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

/** Does ONE floating box hide the whole slot (to within a few px of its border)? */
export function slotHidden(region: Box, floats: readonly Box[]): boolean {
  const m = 4;
  return floats.some((f) => f.x <= region.x + m && f.y <= region.y + m && f.x + f.w >= region.x + region.w - m && f.y + f.h >= region.y + region.h - m);
}
