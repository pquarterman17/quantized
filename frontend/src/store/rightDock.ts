// Tool windows docked at the RIGHT edge (Curve Fit, Peak Analyzer), and the
// clearance the stage needs so its plot reflows to their left — the way
// Origin docks a dialog BESIDE the graph instead of over it (fitting live
// check: the docked Curve Fit covered ~60 px of the plot and the legend).
//
// A window counts as docked while it is open, expanded, and its right edge
// sits within DOCK_SNAP px of the viewport's right edge; dragging it away
// floats it again and the stage takes the room back. Session-only UI state:
// nothing here is saved (the window's own geometry is, in toolWindowLayout).

import { useSyncExternalStore } from "react";

/** How close (px) to the viewport's right edge a window's right edge must be
 *  to count as docked there. */
export const DOCK_SNAP = 24;
/** Gap (px) kept between the stage's content and a docked window. */
export const DOCK_GAP = 8;

const lefts = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: number | null = null;

function publish(): void {
  snapshot = lefts.size ? Math.min(...lefts.values()) : null;
  for (const fn of listeners) fn();
}

/** Record window `id` as docked with its left edge at `left` (viewport px),
 *  or not docked (`null`). */
export function setRightDock(id: string, left: number | null): void {
  if (left === null ? !lefts.has(id) : lefts.get(id) === left) return;
  if (left === null) lefts.delete(id);
  else lefts.set(id, left);
  publish();
}

/** Is a window at (x, width) docked at the right edge of a `viewport`-wide window? */
export function isRightDocked(x: number, width: number, viewport: number): boolean {
  return viewport - (x + width) <= DOCK_SNAP;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The left edge (viewport px) of the left-most right-docked window, or null. */
export function useRightDockLeft(): number | null {
  return useSyncExternalStore(subscribe, () => snapshot, () => null);
}

/** The stage's right padding: how far its box (`right`, viewport px) reaches
 *  under the left-most docked window, plus DOCK_GAP; 0 when nothing is docked
 *  or the window sits wholly outside the stage (over the side column). */
export function rightDockClearance(stageRight: number, dockLeft: number | null): number {
  return dockLeft === null ? 0 : Math.max(0, Math.ceil(stageRight - dockLeft + DOCK_GAP));
}
