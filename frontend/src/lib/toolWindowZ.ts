// Focus order for floating tool windows, bounded to their layer band
// (lib/layers.ts). The old counter went up on EVERY mousedown in any window,
// so a long session eventually painted windows over the palette, tooltips and
// menus. Now a window that is already on top does not move, and the live
// windows are renumbered 1..n whenever the counter would leave the band.

import { TOOL_Z_SPAN } from "./layers";

export interface ToolZHandle {
  /** Current rank (1-based); the window paints at `Z.toolBase + z`. */
  z: number;
  set: (z: number) => void;
}

const live = new Set<ToolZHandle>();
let top = 0;

/** The rank for a window being created (it registers afterwards). */
export function nextToolZ(): number {
  if (top >= TOOL_Z_SPAN) renumber();
  return ++top;
}

export function registerToolWindow(h: ToolZHandle): () => void {
  live.add(h);
  return () => {
    live.delete(h);
  };
}

/** Raise `h` to the top; a no-op (returns false) when it already is. */
export function raiseToolWindow(h: ToolZHandle): boolean {
  if (h.z === top) return false;
  if (top >= TOOL_Z_SPAN) renumber();
  h.z = ++top;
  h.set(h.z);
  return true;
}

/** Re-rank the live windows 1..n, keeping their relative order. */
function renumber(): void {
  const ordered = [...live].sort((a, b) => a.z - b.z);
  ordered.forEach((h, i) => {
    h.z = i + 1;
    h.set(h.z);
  });
  top = ordered.length;
}

/** Test seam. */
export function resetToolWindowZ(): void {
  live.clear();
  top = 0;
}
