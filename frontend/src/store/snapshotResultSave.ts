// Save a snapshot result into the Library (lane RL3): the ONE entry point for
// Distribution, Fit Y by X, Variability, Outlier screening and Multivariate.
// (Statistical tests do not use it: each Run is a new run, never a duplicate.)
//
// - FAIL CLOSED: a missing or still-loading source, or one whose analysis view
//   changed since the tool computed, refuses with the tool's message.
// - IDEMPOTENT BY VALUE: the same computation (lib/snapshotResultKey.ts: source,
//   analysis-view fingerprint, question) already saved and still current creates
//   nothing. The check reads the live `analysisResults`, so after Undo or after
//   deleting the result Save works again (no "saved" flag to get stuck), and a
//   result already marked stale does not block.
// - ONE UNDO STEP: the history entry and the result land together.

import type { AnalysisResult } from "../lib/analysisResult";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import type { CommitSettings } from "../lib/committedOutput";
import { savedSnapshotKey, snapshotResultKey } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { nextAnalysisResultId } from "./idSeq";
import { rowRangeSaveRefusal } from "./rowRangeSaveGuard";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

export interface SnapshotResultSave {
  producerId: string;
  /** "Fit Y by X result", "variability result": names the status lines. */
  noun: string;
  source: Dataset;
  question: CommitSettings;
  /** Status line when the source changed or is not fully loaded. */
  changedMessage: string;
  /** Extra fail-closed check on the live source; returns a status line to refuse. */
  precheck?: (live: Dataset) => string | null;
  build: (id: string, live: Dataset) => AnalysisResult;
  /** The source fingerprint the key and the freshness use (default: the
   *  analysis view; a saved design hashes its design columns only). */
  fingerprint?: (dataset: Dataset) => string;
}

export function findSavedSnapshotResult(results: readonly AnalysisResult[], key: string | null): AnalysisResult | null {
  if (!key) return null;
  return results.find((result) => savedSnapshotKey(result) === key) ?? null;
}

export function publishSnapshotResult(request: SnapshotResultSave): string | null {
  const get = useApp.getState;
  const state = get();
  const { source } = request;
  const fingerprint = request.fingerprint ?? analysisDataFingerprint;
  const live = state.datasets.find((dataset) => dataset.id === source.id);
  if (!live || live.pending || source.pending || fingerprint(live) !== fingerprint(source)) {
    state.setStatus(request.changedMessage);
    return null;
  }
  const refusal = request.precheck?.(live);
  if (refusal) {
    state.setStatus(refusal);
    return null;
  }
  const ranged = rowRangeSaveRefusal(request.producerId, [live.id], `this ${request.noun}`);
  if (ranged) {
    state.setStatus(ranged);
    return null;
  }
  const key = snapshotResultKey(request.producerId, live.id, fingerprint(live), request.question);
  if (findSavedSnapshotResult(state.analysisResults, key)) {
    state.setStatus(`this ${request.noun} is already saved`);
    return null;
  }
  const result = request.build(nextAnalysisResultId(), live);
  asOneEditStep(get, `save ${request.noun}`, () => {
    get().recordHistory(`save ${request.noun}`);
    useApp.setState((current) => ({
      analysisResults: [...current.analysisResults, result], status: `created ${result.name} result`,
    }));
  });
  return result.id;
}
