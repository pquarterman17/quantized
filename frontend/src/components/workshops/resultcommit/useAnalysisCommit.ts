// The workshop half of the shared commit contract (lane RL): a tool hands its
// current computation (or null while there is none) and gets back whether that
// exact computation is already committed, plus the commit itself. The store
// side, store/analysisOutputCommit.ts, owns idempotency and the one undo step;
// this hook only exposes them to a button (disabled + why, not a silent no-op).

import { useMemo, useRef, useState } from "react";

import { findCommittedResultId } from "../../../lib/committedOutput";
import { commitAnalysisOutput, commitKeyFor, type AnalysisCommitOutcome, type AnalysisOutputCommit } from "../../../store/analysisOutputCommit";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { liveOutputRanges } from "../../../store/savedRowRange";
import { replaceTargetFor, useToolReopen } from "../../../store/toolReopen";
import { useApp } from "../../../store/useApp";
import { useReplaceLayoutBlock } from "./useReplaceLayoutBlock";

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

/** `replaceBlock`: a reason (from the tool) why the reopened result's output cannot
 *  be replaced for the computation now live; Replace turns into Add as new. */
export function useAnalysisCommit(request: AnalysisOutputCommit | null, replaceBlock: string | null = null): AnalysisCommitState {
  // Opened from a committed result with Replace chosen: commit into its output.
  const replace = useToolReopen((s) => (request ? replaceTargetFor(s.sessions, request.producer.id, request.sourceId) : undefined));
  const replacing = useApp((state) => {
    const outputId = replace && state.analysisResults.find((result) => result.id === replace)?.outputs[0]?.datasetId;
    return (outputId && state.datasets.find((dataset) => dataset.id === outputId)?.name) || null;
  });
  // Lane RPL: would the NEW computation's columns break what is bound to the old
  // output? Checked live here (the banner shows it) and again at commit time.
  const source = useApp((state) => (request ? state.datasets.find((dataset) => dataset.id === request.sourceId) : undefined));
  const tool = request?.producer.id;
  // The reopened result, whichever mode is chosen: the reason must stay visible while "Add as new" is picked.
  const checkId = useToolReopen((s) => (request && s.sessions[request.producer.id]?.sourceId === request.sourceId ? s.sessions[request.producer.id]?.resultId : undefined));
  const keyForLabels = request ? JSON.stringify([request.sourceId, request.computedOn, request.settings, request.alsoFrom]) : null;
  const newLabels = useMemo(() => {
    if (!request || !checkId || !source || source.pending) return null;
    try { return request.output(source).data.labels; } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyForLabels, checkId, source]);
  useReplaceLayoutBlock(tool, request?.sourceId, newLabels, replaceBlock);
  // The replace target is read AT COMMIT TIME (after a slow prepare too), so a
  // switch to "Add as a new output" while a commit is pending is honoured.
  const withTarget = (req: AnalysisOutputCommit): AnalysisOutputCommit => {
    const target = replaceTargetFor(useToolReopen.getState().sessions, req.producer.id, req.sourceId);
    return target ? { ...req, replace: target } : req;
  };
  const keyInput = request && {
    producer: request.producer, sourceId: request.sourceId, computedOn: request.computedOn, settings: request.settings,
    alsoFrom: request.alsoFrom,
  };
  const keyText = keyInput ? JSON.stringify(keyInput) : null;
  // The row range the tool reads is part of the commit key (OG20): re-key when it changes, so the button
  // says "already added" for the window now set and not for the one before.
  const rangeText = useAnalysisSelection((s) => (request
    ? JSON.stringify(liveOutputRanges(request.producer.id, [request.sourceId, ...(request.alsoFrom ?? []).map((extra) => extra.id)], s.selection)) : ""));
  // Keyed by value so a re-render with an equal request reuses the key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => (keyInput ? commitKeyFor(keyInput) : null), [keyText, rangeText]);
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
      return output ? commitAnalysisOutput(withTarget({ ...request, output })) : null;
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
      : committedAs && replace && resultId !== replace
        // Replace chosen, but ANOTHER result already holds this computation (RO2).
        ? `“${committedAs}” already holds this exact computation, so Replace would leave two identical outputs. Delete it, or choose “Add as a new output” to go to it.`
      : committedAs ? `Already added as “${committedAs}”. Undo or delete it to add it again.` : null,
    commit: () => (request ? commitAnalysisOutput(withTarget(request)) : null),
  };
}
