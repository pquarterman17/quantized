// Lazy loading of the data-driven marks (gap audit 3, N5 + N6): marker size
// from a column, drop lines and the spline connect. Their code (`marksImpl`:
// the spline, the drop-line plugin, the size mapping) is a separate chunk,
// fetched only when a series actually asks for one, so it costs the eager
// bundle nothing for a plot that uses none.
//
// WHILE IT IS PENDING a series that asks for a mark is hidden (never a straight
// stand-in that later jumps, never default-size dots). When it arrives, or after
// two failed attempts, `useMarksVersion` bumps and every renderer rebuilds:
// loaded -> the marks; FAILED -> the plain series with a visible status notice
// (a series is never left hidden). Renderers learn of the arrival through
// `useLazyPlotParts` (plot viewports, the multi-panel stage) or `useMarksVersion`
// (the inset, the colour-column memo); `marksSubscribers.test.ts` keeps that list.

import { useSyncExternalStore } from "react";

import type { SeriesStyle } from "./types";

type Marks = typeof import("./marksImpl");
let mod: Marks | null = null;
let failed = false;
let ver = 0;
let load: Promise<void> | null = null;
const subs = new Set<() => void>();

/** Above this many points a spline is not offered (rows are denser than pixels): the series
 *  draws straight, as `calc.figure_marks.SPLINE_MAX_ROWS` does in the export. */
export const SPLINE_MAX_ROWS = 20000;

/** The loaded implementation, or null while pending or after a failed load. */
export const marks = (): Marks | null => mod;
export const marksFailed = (): boolean => failed;
/** Still on its way: a series that uses a mark is hidden meanwhile. */
export const marksPending = (): boolean => !mod && !failed;

export const usesMarks = (s?: SeriesStyle): boolean => !!(s && (s.connect || s.dropLines || s.sizeBy != null));

/** Do these styles (over `rows` data rows) need the FULL-resolution rows? A size-by column is indexed
 *  by row, and a spline is fitted through the rows, so neither tolerates decimation (a spline only up to
 *  `SPLINE_MAX_ROWS`; above that it is straight and decimation is as for any line). */
export const blocksDecimation = (styles: Iterable<SeriesStyle | undefined>, rows: number): boolean =>
  [...styles].some((s) => s && (s.sizeBy != null || (s.connect === "spline" && rows <= SPLINE_MAX_ROWS)));

/** Fetch the chunk (two attempts); resolves when settled either way. */
export function loadMarks(): Promise<void> {
  return (load ??= (async () => {
    for (let i = 0; i < 2 && !mod; i++) {
      try { mod = await import("./marksImpl"); } catch { /* retried once, then plain */ }
    }
    failed = !mod;
    // The store is imported only on failure: a static import would pull the whole store (and its
    // DOM-touching init) into every module that reaches this one, e2e's Node-side helpers included.
    if (failed) {
      const { useApp } = await import("../store/useApp");
      useApp.getState().setStatus("Spline, drop lines and size-by could not load; those series are drawn plain.");
    }
    ver++;
    subs.forEach((f) => f());
  })());
}

/** Start the load if any of `styles` needs it (idempotent). */
export function ensureMarks(styles: Iterable<SeriesStyle | undefined> | undefined): void {
  if (!load && styles && [...styles].some(usesMarks)) void loadMarks();
}

/** Re-renders a component when the load settles (success or failure). */
export function useMarksVersion(): number {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => ver);
}
