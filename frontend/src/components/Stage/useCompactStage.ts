// Is the map's stage too small for the full toolbar? (UX pass 4 M4.) In the
// window layout a map window can be small (a tiled cell, a floating window at
// ~410 px): the full dock wraps to four rows and leaves the map ~50 px. Below
// these sizes the toolbar collapses to one button that opens it over the map.
// Windows mode only: classic's Map tab and its document windows are unchanged.

import { useEffect, useState, type RefObject } from "react";

import { useApp } from "../../store/useApp";

/** Narrower or shorter than this and the toolbar collapses (px). */
export const COMPACT_BELOW_W = 560;
export const COMPACT_BELOW_H = 360;

export interface StageSize {
  w: number;
  h: number;
}

/** The size of the toolbar's own stage (its parent), kept current; null before the first measure. */
export function useStageSize(dock: RefObject<HTMLElement | null>): StageSize | null {
  const [size, setSize] = useState<StageSize | null>(null);
  useEffect(() => {
    const stage = dock.current?.parentElement;
    if (!stage) return;
    const measure = () => setSize((was) => (was && was.w === stage.clientWidth && was.h === stage.clientHeight ? was : { w: stage.clientWidth, h: stage.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [dock]);
  return size;
}

/** Collapse the toolbar: windows mode and a stage under the sizes above (an unmeasured stage keeps it open). */
export function useCompactToolbar(size: StageSize | null): boolean {
  const windows = useApp((s) => s.layoutMode === "windows");
  return windows && size !== null && size.w > 0 && (size.w < COMPACT_BELOW_W || (size.h > 0 && size.h < COMPACT_BELOW_H));
}
