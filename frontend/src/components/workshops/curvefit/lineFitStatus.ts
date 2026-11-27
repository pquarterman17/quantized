// What the Curve Fit header needs to know about the "Errors in x and y" line fit (Deming
// / York), which runs in its own lazy section with its own state: that a result exists,
// which method made it, and whether its inputs have since changed. Without it the header
// read "Not fitted yet" beside a finished York result (acceptance #1046). `useOdrFit`
// writes it, the panel reads it; a closed panel clears it.
//
// It publishes in a LAYOUT effect: the result section commits its table first, and a
// passive effect would tell the header one render later, after the browser had painted
// "slope" beside "Not fitted yet". A layout effect's store update re-renders the header
// before paint, so the two always appear together (the flake in CurveFitPanel.york.test,
// forced there by a MutationObserver).

import { useEffect, useLayoutEffect } from "react";
import { create } from "zustand";

export interface LineFitNote { method: "York" | "ODR"; stale: boolean }

export const useLineFitNote = create<{ note: LineFitNote | null }>(() => ({ note: null }));

/** Publish `note` for the header while the calling section is mounted, before the browser paints. */
export function usePublishLineFit(note: LineFitNote | null): void {
  const method = note?.method;
  const stale = note?.stale;
  useLayoutEffect(() => {
    useLineFitNote.setState({ note: method ? { method, stale: !!stale } : null });
  }, [method, stale]);
  useEffect(() => () => useLineFitNote.setState({ note: null }), []);
}
