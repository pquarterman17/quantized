// Lane LZ: what a lazy Origin book's arrival means for results that were judged
// while it was only a preview. Lazy (dynamic-imported by store/dataIntake.ts) so
// the fingerprint scan stays out of the eager bundle.
//
// - A result whose source was pending at load could not be fingerprint-checked
//   (`sourcesFingerprint` is null); the install is the first moment it can be.
//   An output that no longer matches is marked stale.
// - An install that dropped exclusions it could not prove changes the analysed
//   rows of everything that reads the book: touchDataset marks the downstream
//   graph and committed outputs.
// Both follow the project's recalc mode like any edit: "off" tracks nothing,
// "manual" marks, "auto" marks and starts a pass (which leaves a committed output
// stale). Snapshot results are NOT marked: their freshness is their fingerprint
// against the live data (`snapshotResultState`), owner decision 2026-11-22.

import { isSnapshotResult } from "../lib/analysisResultFreshness";
import { staleAnalysisOutputs } from "../lib/analysisResultStaleLoad";
import { markStale } from "../lib/recalc";
import type { AppState } from "./useApp";

export function recheckAfterBookInstall(
  get: () => AppState, set: (p: Partial<AppState>) => void, id: string, droppedExclusions: boolean,
): void {
  if (get().recalcMode === "off") return;
  if (droppedExclusions) get().touchDataset(id);
  const s = get();
  const mine = s.analysisResults.filter((r) => !isSnapshotResult(r) && r.sources.some((ref) => ref.datasetId === id));
  const marked = markStale(s.staleDatasets, staleAnalysisOutputs(mine, s.datasets));
  if (marked === s.staleDatasets) return;
  set({ staleDatasets: marked });
  if (s.recalcMode === "auto") void get().recalcNow();
}
