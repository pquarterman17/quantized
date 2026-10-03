// The top inset a stage's plot host needs to clear its floating dock
// (`.qzk-float-tools`). The map dock WRAPS to a second or third row when the
// stage is narrow (it has no overflow menu, unlike PlotToolbar), so a fixed
// inset either wastes a row or lets the dock cover the top tick label and the
// colour bar's maximum. Measuring the dock's real bottom edge is the only
// value that is right at every width.

import { useEffect, useState } from "react";

/** Gap (px) between the dock's bottom edge and the plot host. */
export const DOCK_GAP = 6;

/** Top inset (px) for a host that must sit below `dock`: the dock's bottom
 *  edge plus `DOCK_GAP`, kept current as the dock wraps or unwraps. `fallback`
 *  while no dock is mounted. */
export function useDockClearance(dock: HTMLElement | null, fallback = 8): number {
  const [top, setTop] = useState(fallback);
  useEffect(() => {
    if (!dock) {
      setTop(fallback);
      return;
    }
    const measure = () => setTop(Math.max(fallback, Math.ceil(dock.offsetTop + dock.offsetHeight + DOCK_GAP)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(dock);
    return () => ro.disconnect();
  }, [dock, fallback]);
  return top;
}
