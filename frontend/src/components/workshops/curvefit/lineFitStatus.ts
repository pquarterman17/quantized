// What the Curve Fit header needs to know about the "Errors in x and y" line fit (Deming
// / York), which runs in its own lazy section with its own state: that a result exists,
// which method made it, and whether its inputs have since changed. Without it the header
// read "Not fitted yet" beside a finished York result (acceptance #1046). `useOdrFit`
// writes it, the panel reads it; a closed panel clears it.

import { useEffect } from "react";
import { create } from "zustand";

export interface LineFitNote { method: "York" | "ODR"; stale: boolean }

export const useLineFitNote = create<{ note: LineFitNote | null }>(() => ({ note: null }));

/** Publish `note` for the header while the calling section is mounted. */
export function usePublishLineFit(note: LineFitNote | null): void {
  const method = note?.method;
  const stale = note?.stale;
  useEffect(() => {
    useLineFitNote.setState({ note: method ? { method, stale: !!stale } : null });
  }, [method, stale]);
  useEffect(() => () => useLineFitNote.setState({ note: null }), []);
}
