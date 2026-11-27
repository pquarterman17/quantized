// The grid's scroll position and viewport metrics, extracted from
// GridViewport.tsx under the component ceiling: the scroll offsets (mirrored
// into state so the row/column window moves this render), the measured
// viewport size and the density-token row height, re-measured on resize.

import { useLayoutEffect, useState, type RefObject } from "react";

import { DEFAULT_ROW_HEIGHT } from "../../../lib/gridwindow";

/** The row height token, read once per mount (and on resize, in case a
 *  density change re-runs it) — falls back to a fixed default when the token
 *  isn't defined (a bare test render with no stylesheet loaded). */
export function readRowHeight(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue("--row-h");
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ROW_HEIGHT;
}

export function useGridScroll(scrollRef: RefObject<HTMLDivElement | null>) {
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [metrics, setMetrics] = useState({ width: 0, height: 0, rowHeight: DEFAULT_ROW_HEIGHT });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setMetrics({ width: el.clientWidth, height: el.clientHeight, rowHeight: readRowHeight(el) });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [scrollRef]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScroll({ top: el.scrollTop, left: el.scrollLeft });
  };
  return { scroll, setScroll, metrics, onScroll };
}
