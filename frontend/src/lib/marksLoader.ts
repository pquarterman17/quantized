// Lazy loading of the data-driven marks (gap audit 3, N5 + N6): marker size
// from a column, drop lines and the spline connect. Their code (`marksImpl`:
// the spline, the drop-line plugin, the size mapping) is a separate chunk,
// fetched only when a series actually asks for one, so it costs the eager
// bundle nothing for a plot that uses none.
//
// UNTIL IT ARRIVES a series that asks for a mark draws NOTHING of that mark and
// never a different shape: a spline series gets no connecting line (not a straight
// one that would then jump), a size-by series is hidden (not default-size
// dots), drop lines are simply absent. The arrival bumps `marksVersion`, which
// PlotViewport (and the colour-column memo) depend on, so the plot rebuilds.

import { useSyncExternalStore } from "react";

import type { SeriesStyle } from "./types";

type Marks = typeof import("./marksImpl");
let mod: Marks | null = null;
let loading = false;
const subs = new Set<() => void>();

/** The loaded implementation, or null while it is still on its way. */
export const marks = (): Marks | null => mod;

export const usesMarks = (s?: SeriesStyle): boolean => !!(s && (s.connect || s.dropLines || s.sizeBy != null));

/** Start the load if any of `styles` needs it (idempotent). */
export function ensureMarks(styles: Iterable<SeriesStyle | undefined> | undefined): void {
  if (!mod && !loading && styles && [...styles].some(usesMarks)) {
    loading = true;
    void import("./marksImpl").then((m) => { mod = m; subs.forEach((f) => f()); });
  }
}

/** Re-renders a component when the marks implementation arrives (the snapshot is the module). */
export function useMarksVersion(): Marks | null {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), marks);
}
