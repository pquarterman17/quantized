import { useRef } from "react";

import { placeNewToolWindow } from "../../lib/toolWindowPlacement";

/** A panel with no position of its own opens beside the focused plot, never over
 *  its toolbar (lib/toolWindowPlacement, u11). Computed ONCE per mount, so a window
 *  with no saved rect does not follow the plot around; null when `wanted` is false. */
export function useNewToolPlacement(width: number, wanted: boolean): { x: number; y: number } | null {
  const placed = useRef<{ x: number; y: number } | null>(null);
  if (!placed.current && wanted) placed.current = placeNewToolWindow(width, { x: 120, y: 90 });
  return placed.current;
}
