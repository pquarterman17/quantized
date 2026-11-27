// Replace a committed analysis output in place (lane RO, "Open in <tool>").
// A tool reopened from a committed result commits its new computation INTO the
// old output worksheet (same dataset id, so plots and figures bound to it
// follow) and rewrites the old AnalysisResult (same id, so the Library item,
// its notes and its name stay), in ONE undo step: Ctrl+Z restores the old data
// and the old envelope together.
//
// Figures, plots, graph curves, sheet() formulas and other results bound to the
// old worksheet by column index are re-pointed BY COLUMN NAME in the same step
// (store/analysisOutputLayout.ts); a bound column that would vanish or become
// ambiguous refuses the replace, by name.
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
import { isCommittedOutputResult, REOPEN_PARAM } from "../lib/committedOutputGraph";
import { mayReplaceProducer, replaceBlockedReason } from "../lib/committedOutputReopen";
import { stampInputRowRanges, type SourceRowRange } from "../lib/inputRowRange";
import type { Dataset } from "../lib/types";
import type { AnalysisCommitOutcome, AnalysisOutputCommit } from "./analysisOutputCommit";
import { outputLayoutPatch, outputLayoutVerdict } from "./analysisOutputLayout";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

/** What the envelope records for a later reopen: the source view the output was
 *  computed on, the output's own view (to detect edits), the name the TOOL gave
 *  it (to tell a user's rename apart) and the tool extras. */
export function reopenRecord(
  request: Pick<AnalysisOutputCommit, "computedOn" | "reopenExtra" | "alsoFrom">, output: Dataset, toolName: string,
): CommitSettings {
  return {
    computedOn: request.computedOn,
    // A multi-source output: each further source's view as computed (reopen checks them).
    ...(request.alsoFrom?.length ? { alsoFrom: request.alsoFrom } : {}),
    output: analysisDataFingerprint(output),
    name: toolName,
    ...(request.reopenExtra ? { extra: request.reopenExtra } : {}),
  };
}

function pick<K extends keyof Dataset>(dataset: Dataset, keys: readonly K[]): Partial<Pick<Dataset, K>> {
  const out: Partial<Pick<Dataset, K>> = {};
  for (const key of keys) if (dataset[key] !== undefined) out[key] = dataset[key];
  return out;
}

export function replaceCommittedOutput(
  request: AnalysisOutputCommit,
  resultId: string,
  source: Dataset,
  extraSources: readonly Dataset[],
  key: string,
  refuse: (reason: string) => AnalysisCommitOutcome,
  inputRanges: readonly SourceRowRange[] = [],
): AnalysisCommitOutcome {
  const get = useApp.getState;
  const state = get();
  const label = request.producer.label;
  const target = state.analysisResults.find((result) => result.id === resultId);
  if (!target || !isCommittedOutputResult(target) || !mayReplaceProducer(target.producer.id, request.producer.id)) {
    return refuse(`${label}: the result to replace no longer exists; nothing was changed`);
  }
  if (target.sources[0]?.datasetId !== source.id) return refuse(`${label}: the result to replace has a different source; nothing was changed`);
  // Replace swaps ONE worksheet in place; a multi-output result would keep its other parts from the old computation.
  if (target.outputs.length !== 1) return refuse(`${label}: the result to replace has ${target.outputs.length} output worksheets; replace works on one. Choose “Add as new”; nothing was changed`);
  const outputId = target.outputs[0]!.datasetId;
  const old = state.datasets.find((dataset) => dataset.id === outputId);
  const blocked = replaceBlockedReason(target, old);
  if (blocked || !old) return refuse(`${label}: ${blocked ?? "the output is missing"} Choose “Add as new” to keep it.`);

  const built = request.output(source);
  // Everything bound to the old worksheet by column index must follow by name,
  // or the replace is refused (re-checked here, at commit time, on live state).
  const layout = outputLayoutVerdict(state, outputId, built.data.labels, target.id);
  if (!layout.ok) return refuse(`${label}: ${layout.reason} Choose “Add as new” to keep it.`);
  // A user's rename of the output survives; the tool's own name follows the new computation.
  const recorded = target.parameters?.[REOPEN_PARAM];
  const toolName = recorded && typeof recorded === "object" && !Array.isArray(recorded) && typeof recorded["name"] === "string"
    ? recorded["name"] : target.tableRefs?.[0]?.label;
  const name = old.name === toolName ? built.name : old.name;
  // Only identity and Library organisation carry over; nothing shaped by the
  // old data does (replaceBlockedReason refused any worksheet edit already).
  const output: Dataset = {
    ...pick(old, ["notes", "tags", "group", "folderId", "order", "workbookId", "importedAt", "source"]),
    id: old.id, name, data: stampInputRowRanges(built.data, inputRanges), ...(built.errorRoles ? { errorRoles: built.errorRoles } : {}),
    ...(built.derivedFrom ? { derivedFrom: built.derivedFrom } : {}),
  };
  const fresh = committedOutputResult({
    id: target.id, producer: request.producer, source, extraSources, output, key, settings: request.settings,
    reopen: reopenRecord(request, output, built.name), xKey: request.xKey, ...(request.xWindow ? { xWindow: request.xWindow } : {}), ...(request.yChannel !== undefined ? { yChannel: request.yChannel } : {}), createdAt: target.createdAt,
  });
  const { stale: _wasStale, ...rest } = target;
  const next = {
    ...rest,
    // `sources` too: a multi-source output may now be computed from other worksheets (lane RO2).
    producer: fresh.producer, sources: fresh.sources, parameters: fresh.parameters, sourceFingerprint: fresh.sourceFingerprint,
    tableRefs: fresh.tableRefs, plotBindings: fresh.plotBindings, warnings: [], updatedAt: new Date().toISOString(),
  };
  if (state.staleDatasets.includes(outputId)) {
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => (r.id === target.id ? { ...r, stale: true as const } : r)) }));
  }
  const step = `replace ${label} output`;
  asOneEditStep(get, step, () => {
    get().recordHistory(step);
    useApp.setState((s) => {
      const datasets = s.datasets.map((dataset) => (dataset.id === outputId ? output : dataset));
      const analysisResults = s.analysisResults.map((result) => (result.id === target.id ? next : result));
      // Bindings follow their columns by name in this same step (Undo restores them with the data).
      return { datasets, analysisResults, ...outputLayoutPatch({ ...s, datasets, analysisResults }, outputId, layout.shifts, datasets, target.id) };
    });
  });
  useApp.setState((s) => ({ staleDatasets: s.staleDatasets.filter((id) => id !== outputId) }));
  // Anything derived FROM the output is now out of date.
  get().touchDataset(outputId);
  get().setStatus(`replaced “${name}” with the new ${label} output`);
  return { kind: "replaced", resultId: target.id, outputId };
}
