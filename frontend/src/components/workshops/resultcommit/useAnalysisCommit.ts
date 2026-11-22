// The workshop half of the shared commit contract (lane RL): a tool hands its
// current computation (or null while there is none) and gets back whether that
// exact computation is already committed, plus the commit itself. The store
// side, store/analysisOutputCommit.ts, owns idempotency and the one undo step;
// this hook only exposes them to a button (disabled + why, not a silent no-op).

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { findCommittedResultId } from "../../../lib/committedOutput";
import { outputLayoutVerdict } from "../../../store/analysisOutputLayout";
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

export function useAnalysisCommit(request: AnalysisOutputCommit | null): AnalysisCommitState {
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
  // Only the slices the verdict reads, so unrelated store updates (pan, zoom, status) do not rescan.
  const slices = useApp(useShallow((s) => ({
    datasets: s.datasets, plotWindows: s.plotWindows, layers: s.layers, activeId: s.activeId, editableFigures: s.editableFigures,
    figureDocs: s.figureDocs, savedPlotSpecs: s.savedPlotSpecs, analysisResults: s.analysisResults, xKey: s.xKey, yKeys: s.yKeys,
    y2Keys: s.y2Keys, groupKey: s.groupKey, facetKey: s.facetKey, errKeys: s.errKeys,
  })));
  const layoutReason = useMemo(() => {
    const outputId = checkId && slices.analysisResults.find((result) => result.id === checkId)?.outputs[0]?.datasetId;
    if (!outputId || !newLabels || !checkId) return null;
    const verdict = outputLayoutVerdict(slices, outputId, newLabels, checkId);
    return verdict.ok ? null : verdict.reason;
  }, [slices, newLabels, checkId]);
  const setLayoutBlocked = useToolReopen((s) => s.setLayoutBlocked);
  useEffect(() => {
    if (!tool) return undefined;
    setLayoutBlocked(tool, layoutReason);
    // Cleared when the request goes away (settings invalidated) or the tool closes.
    return () => setLayoutBlocked(tool, null);
  }, [tool, layoutReason, setLayoutBlocked]);
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
      : committedAs ? `Already added as “${committedAs}”. Undo or delete it to add it again.` : null,
    commit: () => (request ? commitAnalysisOutput(withTarget(request)) : null),
  };
}
