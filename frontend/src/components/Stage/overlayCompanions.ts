// Does the active dataset have any COMPANION drawing beyond its own series —
// a fit/baseline/peak/derivative overlay, a row selection, or greyed excluded
// rows? Extracted from usePlotPayload.ts to keep that hook under the 500-line
// module ceiling (a 2026-09-09 review correction needed more prose there, and
// shaving the explanation to fit is the anti-pattern the ceiling exists to
// prevent). A pure predicate over already-resolved overlay state — no React,
// no store — so it unit-tests standalone.

import type { BaselineOverlay, FitOverlay, PeakOverlay } from "../../lib/types";

export function hasOverlayCompanions(args: {
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  derivOverlay: FitOverlay | null;
  selection: { datasetId: string; rows: number[] } | null;
  excludedDisplay: "hide" | "grey";
  activeId: string;
  dropped: Set<number>;
}): boolean {
  if (args.fitOverlay?.datasetId === args.activeId) return true;
  if (args.baselineOverlay?.datasetId === args.activeId) return true;
  if (args.peakOverlay?.datasetId === args.activeId) return true;
  if (args.derivOverlay?.datasetId === args.activeId) return true;
  if (args.selection?.datasetId === args.activeId) return true;
  if (args.excludedDisplay === "grey" && args.dropped.size > 0) return true;
  return false;
}
