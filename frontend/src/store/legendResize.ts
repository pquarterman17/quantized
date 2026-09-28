// Legend resize writers. Only the lazy resize handles
// (components/Stage/LegendResizeHandles.tsx) import this module, so these stay
// off the eager bundle; as store-slice actions they would load with the store.

import { useApp } from "./useApp";

/** Commit a resize and its top-left position as one undoable edit. Also clears
 *  an Origin frame anchor, as `setLegendXY` does. */
export function commitLegendBounds(xy: [number, number], size: [number, number]): void {
  useApp.getState().recordHistory("resize legend");
  useApp.setState({ legendXY: xy, legendFrameXY: null, legendSize: size });
}

/** Return to content-driven sizing, as one undoable edit. */
export function fitLegendToContents(): void {
  useApp.getState().recordHistory("fit legend to contents");
  useApp.setState({ legendSize: null });
}
