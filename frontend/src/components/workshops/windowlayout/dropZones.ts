// Pure drop-zone hit-testing for dragging a window's title bar over the desk
// (WORKSPACE_LAYOUT_PLAN P2). No React, no DOM: `dropZoneAt` maps a pointer
// position to the slot a release would dock into, or null (a release floats
// the window). The previews themselves are CSS over the desk's `--wl-*` edge
// sizes (DropZones.tsx), so they always match what a drop produces.

import type { Slot } from "../../../lib/windowLayout/types";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How close to an edge (px) the pointer must be to dock there; never more
 *  than a quarter of the desk, so a small desk still has a free middle. */
export const EDGE_BAND_PX = 56;
/** Half the width / height of the centre zone, as a fraction of the desk: a
 *  small box in the middle, so moving a float around never docks it by chance. */
export const CENTRE_HALF = 0.15;

/** The slot a drop at `p` docks into, or null (float). Left and right win
 *  over the bottom band in a corner (they run the full height of the desk). A
 *  point outside the desk is null. */
export function dropZoneAt(p: { x: number; y: number }, desk: Box): Slot | null {
  if (!(desk.w > 0) || !(desk.h > 0)) return null;
  const x = p.x - desk.x;
  const y = p.y - desk.y;
  if (x < 0 || y < 0 || x > desk.w || y > desk.h) return null;
  const bandX = Math.min(EDGE_BAND_PX, desk.w / 4);
  const bandY = Math.min(EDGE_BAND_PX, desk.h / 4);
  if (x <= bandX) return "left";
  if (x >= desk.w - bandX) return "right";
  if (y >= desk.h - bandY) return "bottom";
  if (Math.abs(x / desk.w - 0.5) <= CENTRE_HALF && Math.abs(y / desk.h - 0.5) <= CENTRE_HALF) return "centre";
  return null;
}
