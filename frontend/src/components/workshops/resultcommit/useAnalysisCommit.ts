// The workshop half of the shared commit contract (lane RL): a tool hands its
// current computation (or null while there is none) and gets back whether that
// exact computation is already committed, plus the commit itself. The store
// side, store/analysisOutputCommit.ts, owns idempotency and the one undo step;
// this hook only exposes them to a button (disabled + why, not a silent no-op).

import { useMemo } from "react";

import { findCommittedResultId } from "../../../lib/committedOutput";
import { commitAnalysisOutput, commitKeyFor, type AnalysisCommitOutcome, type AnalysisOutputCommit } from "../../../store/analysisOutputCommit";
import { useApp } from "../../../store/useApp";

export interface AnalysisCommitState {
  /** Name of the existing output worksheet when this computation is already committed. */
  committedAs: string | null;
  /** Why the commit button is disabled (null when it is enabled). */
  disabledReason: string | null;
  commit: () => AnalysisCommitOutcome | null;
}

export function useAnalysisCommit(request: AnalysisOutputCommit | null): AnalysisCommitState {
  const keyInput = request && {
    producer: request.producer, sourceId: request.sourceId, computedOn: request.computedOn, settings: request.settings,
  };
  const keyText = keyInput ? JSON.stringify(keyInput) : null;
  // Keyed by value so a re-render with an equal request reuses the key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => (keyInput ? commitKeyFor(keyInput) : null), [keyText]);
  const resultId = useApp((state) => findCommittedResultId(state.analysisResults, state.datasets, state.staleDatasets, key));
  const committedAs = useApp((state) => {
    if (!resultId) return null;
    const outputId = state.analysisResults.find((result) => result.id === resultId)?.outputs[0]?.datasetId;
    return state.datasets.find((dataset) => dataset.id === outputId)?.name ?? null;
  });
  return {
    committedAs,
    disabledReason: !request ? "Run the analysis first."
      : committedAs ? `Already added as “${committedAs}”. Undo or delete it to add it again.` : null,
    commit: () => (request ? commitAnalysisOutput(request) : null),
  };
}
