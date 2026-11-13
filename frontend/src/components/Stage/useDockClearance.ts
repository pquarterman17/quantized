// The top inset a stage's plot host needs to clear its floating dock
// (`.qzk-float-tools`). The map dock WRAPS to a second or third row when the
// stage is narrow (it has no overflow menu, unlike PlotToolbar), so a fixed
// inset either wastes a row or lets the dock cover the top tick label and the
// colour bar's maximum. Measuring the dock's real bottom edge is the only
// value that is right at every width.

import { useEffect, useState } from "react";

/** Gap (px) between the dock's bottom edge and the plot host. */
export const DOCK_GAP = 6;

/** The CSS custom property `usePublishDockClearance` writes on the stage. */
export const DOCK_CLEAR_VAR = "--qz-dock-clear";

/** Publish the dock's bottom edge (plus `DOCK_GAP`) as `--qz-dock-clear` on
 *  the dock's parent stage, kept current as the dock changes size, so the
 *  XY plot host can start below it (figures audit #15: in a small window the
 *  plot dock — group captions on — ends ~63px down, past the host's fixed
 *  60px inset, and covered the top tick label, "10⁵"). A CSS variable, not
 *  React state: the dock and the host are siblings in different components,
 *  and the host's own ResizeObserver re-lays the plot out when it moves. */
export function usePublishDockClearance(dockRef: { readonly current: HTMLElement | null }): void {
  useEffect(() => {
    const dock = dockRef.current;
    const stage = dock?.parentElement;
    if (!dock || !stage) return;
    const measure = () =>
      stage.style.setProperty(DOCK_CLEAR_VAR, `${Math.ceil(dock.offsetTop + dock.offsetHeight + DOCK_GAP)}px`);
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(dock);
    return () => {
      ro?.disconnect();
      stage.style.removeProperty(DOCK_CLEAR_VAR);
    };
  }, [dockRef]);
}

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
