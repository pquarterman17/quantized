// Commit one analysis output worksheet + its Library result (lane RL, the
// shared result lifecycle). The one store entry point a tool's
// "Add … as dataset" goes through:
//
// - ONE UNDO STEP: the worksheet and its AnalysisResult land together under the
//   tool's label (asOneEditStep folds addDataset's own entry), so Ctrl+Z
//   removes both and Redo restores both.
// - IDEMPOTENT: a repeat commit of the same computation (same source data,
//   settings and result; lib/committedOutput.ts's key) creates nothing; it
//   shows the existing output instead. After Undo, or once the source changed
//   (the output is stale), a commit creates a new output again.
// - FAIL CLOSED: a missing or still-loading source, or a source whose analysis
//   view changed since the tool computed, refuses with a reason and writes
//   nothing.
// - STALE ON INPUT CHANGE: the envelope lists the output, so the recalc graph
//   (lib/committedOutputGraph.ts) marks it stale per the project's recalc mode.

import type { AnalysisResultProducer } from "../lib/analysisResult";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { committedOutputKey, committedOutputResult, findCommittedResultId, type CommitSettings } from "../lib/committedOutput";
import type { Dataset, DataStruct } from "../lib/types";
import { nextAnalysisResultId, nextDatasetId } from "./idSeq";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

export interface AnalysisOutputCommit {
  producer: AnalysisResultProducer;
  sourceId: string;
  /** `analysisDataFingerprint(source)` as of the computation being committed. */
  computedOn: string;
  /** Further source worksheets of a multi-source output (a batch trend), each
   *  with its analysis-view fingerprint as computed. Part of the commit key;
   *  every one must still match (fail closed) and is listed in the envelope, so
   *  a change to ANY source marks the output stale. */
  alsoFrom?: readonly { id: string; computedOn: string }[];
  /** Inputs plus the result digest the output encodes (small: no arrays of data). */
  settings: CommitSettings;
  /** Built only when a new output is actually written. */
  output: (source: Dataset) => { name: string; data: DataStruct; errorRoles?: Dataset["errorRoles"] };
  /** Status line on success. */
  status?: string;
}

export type AnalysisCommitOutcome =
  | { kind: "created" | "existing"; resultId: string; outputId: string }
  | { kind: "refused"; reason: string };

export function commitKeyFor(request: Pick<AnalysisOutputCommit, "producer" | "sourceId" | "computedOn" | "settings" | "alsoFrom">): string {
  // Single-source keys stay byte-identical to the original contract.
  const settings = request.alsoFrom?.length ? { ...request.settings, alsoFrom: request.alsoFrom } : request.settings;
  return committedOutputKey(request.producer.id, request.sourceId, request.computedOn, settings);
}

export function commitAnalysisOutput(request: AnalysisOutputCommit): AnalysisCommitOutcome {
  const get = useApp.getState;
  const state = get();
  const refuse = (reason: string): AnalysisCommitOutcome => {
    state.setStatus(reason, "danger");
    return { kind: "refused", reason };
  };
  const source = state.datasets.find((dataset) => dataset.id === request.sourceId);
  if (!source) return refuse(`${request.producer.label}: the source worksheet no longer exists; nothing was added`);
  if (source.pending) return refuse(`${request.producer.label}: load the full source worksheet before adding its output`);
  if (analysisDataFingerprint(source) !== request.computedOn) {
    return refuse(`${request.producer.label}: the source changed after this result was computed; run it again before adding it`);
  }
  const extraSources: Dataset[] = [];
  for (const extra of request.alsoFrom ?? []) {
    const dataset = state.datasets.find((d) => d.id === extra.id);
    if (!dataset) return refuse(`${request.producer.label}: a source worksheet no longer exists; nothing was added`);
    if (dataset.pending) return refuse(`${request.producer.label}: load the full source worksheets before adding the output`);
    if (analysisDataFingerprint(dataset) !== extra.computedOn) {
      return refuse(`${request.producer.label}: “${dataset.name}” changed after this result was computed; run it again before adding it`);
    }
    extraSources.push(dataset);
  }
  const key = commitKeyFor(request);
  const existingId = findCommittedResultId(state.analysisResults, state.datasets, state.staleDatasets, key);
  if (existingId) {
    const existing = state.analysisResults.find((result) => result.id === existingId)!;
    const outputId = existing.outputs[0]!.datasetId;
    const name = state.datasets.find((dataset) => dataset.id === outputId)?.name ?? outputId;
    state.setActive(outputId);
    get().setStatus(`this ${request.producer.label} output is already added as “${name}”; nothing was duplicated`);
    return { kind: "existing", resultId: existingId, outputId };
  }
  const built = request.output(source);
  const output: Dataset = {
    id: nextDatasetId(), name: built.name, data: built.data,
    ...(built.errorRoles ? { errorRoles: built.errorRoles } : {}),
  };
  const result = committedOutputResult({
    id: nextAnalysisResultId(), producer: request.producer, source, extraSources, output, key, settings: request.settings,
  });
  asOneEditStep(get, `add ${request.producer.label} output`, () => {
    get().addDataset(output);
    useApp.setState((current) => ({ analysisResults: [...current.analysisResults, result] }));
  });
  get().setStatus(request.status ?? `added ${output.name}`);
  return { kind: "created", resultId: result.id, outputId: output.id };
}
