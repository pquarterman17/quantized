// "Peak Fitting ▸ Fit this range" (audit P2.4 slice 3) — the one-shot hand-off
// from the plot's context menu to the Peak Analyzer. A tiny standalone zustand
// store, the same shape as store/combineDialog.ts (see that header): transient
// UI intent, not project data — no `.dwk` hook-in, no undo entry, and zero
// lines in useApp.ts (which sits at its STORE_PINS ratchet). The menu writes a
// request and opens the wizard; the wizard (usePeakWizard) applies the range,
// finds peaks, and consumes the request by its `seq`, so a newer request made
// meanwhile is never swallowed by an older consume.

import { create } from "zustand";

export interface PeakFitRangeRequest {
  /** The dataset the range was selected on — the wizard refuses another one. */
  datasetId: string;
  lo: number;
  hi: number;
  seq: number;
}

interface PeakFitRangeState {
  request: PeakFitRangeRequest | null;
}

export const usePeakFitRange = create<PeakFitRangeState>(() => ({ request: null }));

let seq = 0;

/** Ask the Peak Analyzer to fit [lo, hi] of `datasetId` (order-free). */
export function requestPeakFitRange(datasetId: string, lo: number, hi: number): void {
  usePeakFitRange.setState({ request: { datasetId, lo: Math.min(lo, hi), hi: Math.max(lo, hi), seq: ++seq } });
}

/** Mark request `id` handled (a no-op if a newer one has replaced it). */
export function consumePeakFitRange(id: number): void {
  if (usePeakFitRange.getState().request?.seq === id) usePeakFitRange.setState({ request: null });
}
