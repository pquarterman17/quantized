// The workshop half of the shared commit contract (lane RL): a tool hands its
// current computation (or null while there is none) and gets back whether that
// exact computation is already committed, plus the commit itself. The store
// side, store/analysisOutputCommit.ts, owns idempotency and the one undo step;
// this hook only exposes them to a button (disabled + why, not a silent no-op).

import { useMemo, useRef, useState } from "react";

import { findCommittedResultId } from "../../../lib/committedOutput";
import { commitAnalysisOutput, commitKeyFor, type AnalysisCommitOutcome, type AnalysisOutputCommit } from "../../../store/analysisOutputCommit";
import { replaceTargetFor, useToolReopen } from "../../../store/toolReopen";
import { useApp } from "../../../store/useApp";

export interface AnalysisCommitState {
  /** Name of the existing output worksheet when this computation is already committed. */
  committedAs: string | null;
  /** Why the commit button is disabled (null when it is enabled). */
  disabledReason: string | null;
  commit: () => AnalysisCommitOutcome | null;
  /** For a tool whose output needs an async step (a full-data fetch) before it
   *  can be built: `prepare` resolves the output builder, or null to abandon.
   *  IN-FLIGHT GUARD: while one is pending a second call is ignored (prepare
   *  does not run again), so two clicks during a slow compute make ONE commit. */
  commitAsync: (prepare: () => Promise<AnalysisOutputCommit["output"] | null>) => Promise<AnalysisCommitOutcome | null>;
  /** True while a `commitAsync` is pending. */
  inFlight: boolean;
  /** Lane RO: the output worksheet a commit REPLACES (the tool was opened from
   *  its result and the user chose Replace), or null when a commit adds new. */
  replacing: string | null;
}

export function useAnalysisCommit(base: AnalysisOutputCommit | null): AnalysisCommitState {
  // Opened from a committed result with Replace chosen: commit into its output.
  const replace = useToolReopen((s) => (base ? replaceTargetFor(s.sessions, base.producer.id, base.sourceId) : undefined));
  const replacing = useApp((state) => {
    const outputId = replace && state.analysisResults.find((result) => result.id === replace)?.outputs[0]?.datasetId;
    return (outputId && state.datasets.find((dataset) => dataset.id === outputId)?.name) || null;
  });
  const request = base && replace ? { ...base, replace } : base;
  const keyInput = request && {
    producer: request.producer, sourceId: request.sourceId, computedOn: request.computedOn, settings: request.settings,
    alsoFrom: request.alsoFrom,
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
  const pending = useRef(false);
  const [inFlight, setInFlight] = useState(false);
  const commitAsync: AnalysisCommitState["commitAsync"] = async (prepare) => {
    if (!request || pending.current) return null;
    pending.current = true;
    setInFlight(true);
    try {
      const output = await prepare();
      return output ? commitAnalysisOutput({ ...request, output }) : null;
    } finally {
      pending.current = false;
      setInFlight(false);
    }
  };
  return {
    committedAs,
    inFlight,
    replacing,
    commitAsync,
    disabledReason: !request ? "Run the analysis first."
      : inFlight ? "Adding the output…"
      : committedAs ? `Already added as “${committedAs}”. Undo or delete it to add it again.` : null,
    commit: () => (request ? commitAnalysisOutput(request) : null),
  };
}
