// Replace a committed analysis output in place (lane RO, "Open in <tool>").
// A tool reopened from a committed result commits its new computation INTO the
// old output worksheet (same dataset id, so plots and figures bound to it
// follow) and rewrites the old AnalysisResult (same id, so the Library item,
// its notes and its name stay), in ONE undo step: Ctrl+Z restores the old data
// and the old envelope together.
//
// FAIL CLOSED: the target must still be a committed result of the same
// producer on the same source, and its output worksheet must be unedited since
// it was added (lib/committedOutputReopen.ts's `replaceBlockedReason`);
// otherwise nothing is written and the reason is shown.
//
// Undo and staleness: `staleDatasets` is session state outside undo. When the
// old output was stale, its envelope is marked `stale` (a true fact, and the
// save-side stamp's own rule) BEFORE the step, so Undo brings back an envelope
// that still says Out of date instead of a stale output reading as current.

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { committedOutputResult, type CommitSettings } from "../lib/committedOutput";
import { isCommittedOutputResult } from "../lib/committedOutputGraph";
import { replaceBlockedReason } from "../lib/committedOutputReopen";
import type { Dataset } from "../lib/types";
import type { AnalysisCommitOutcome, AnalysisOutputCommit } from "./analysisOutputCommit";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

/** What the envelope records for a later reopen: the source view the output was
 *  computed on, the output's own view (to detect edits) and the tool extras. */
export function reopenRecord(request: Pick<AnalysisOutputCommit, "computedOn" | "reopenExtra">, output: Dataset): CommitSettings {
  return {
    computedOn: request.computedOn,
    output: analysisDataFingerprint(output),
    ...(request.reopenExtra ? { extra: request.reopenExtra } : {}),
  };
}

export function replaceCommittedOutput(
  request: AnalysisOutputCommit,
  resultId: string,
  source: Dataset,
  extraSources: readonly Dataset[],
  key: string,
  refuse: (reason: string) => AnalysisCommitOutcome,
): AnalysisCommitOutcome {
  const get = useApp.getState;
  const state = get();
  const label = request.producer.label;
  const target = state.analysisResults.find((result) => result.id === resultId);
  if (!target || !isCommittedOutputResult(target) || target.producer.id !== request.producer.id) {
    return refuse(`${label}: the result to replace no longer exists; nothing was changed`);
  }
  if (target.sources[0]?.datasetId !== source.id) return refuse(`${label}: the result to replace has a different source; nothing was changed`);
  const outputId = target.outputs[0]!.datasetId;
  const old = state.datasets.find((dataset) => dataset.id === outputId);
  const blocked = replaceBlockedReason(target, old);
  if (blocked || !old) return refuse(`${label}: ${blocked ?? "the output is missing"} Choose “Add as new” to keep it.`);

  const built = request.output(source);
  // A user's rename of the output survives; the tool's own name follows the new computation.
  const name = old.name === target.tableRefs?.[0]?.label ? built.name : old.name;
  const { errorRoles: _oldRoles, ...kept } = old;
  const output: Dataset = { ...kept, name, data: built.data, ...(built.errorRoles ? { errorRoles: built.errorRoles } : {}) };
  const fresh = committedOutputResult({
    id: target.id, producer: request.producer, source, extraSources, output, key, settings: request.settings,
    reopen: reopenRecord(request, output), createdAt: target.createdAt,
  });
  const { stale: _wasStale, ...rest } = target;
  const next = {
    ...rest,
    producer: fresh.producer, parameters: fresh.parameters, sourceFingerprint: fresh.sourceFingerprint,
    tableRefs: fresh.tableRefs, plotBindings: fresh.plotBindings, warnings: [], updatedAt: new Date().toISOString(),
  };
  if (state.staleDatasets.includes(outputId)) {
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => (r.id === target.id ? { ...r, stale: true as const } : r)) }));
  }
  const step = `replace ${label} output`;
  asOneEditStep(get, step, () => {
    get().recordHistory(step);
    useApp.setState((s) => ({
      datasets: s.datasets.map((dataset) => (dataset.id === outputId ? output : dataset)),
      analysisResults: s.analysisResults.map((result) => (result.id === target.id ? next : result)),
    }));
  });
  useApp.setState((s) => ({ staleDatasets: s.staleDatasets.filter((id) => id !== outputId) }));
  // Anything derived FROM the output is now out of date.
  get().touchDataset(outputId);
  get().setStatus(`replaced “${name}” with the new ${label} output`);
  return { kind: "replaced", resultId: target.id, outputId };
}
