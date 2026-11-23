// Baseline workshop — batch helpers. "Apply to N selected" runs the SAME method +
// params on every selected dataset; the estimates are computed first (async, no
// store writes), then every output lands in ONE synchronous edit step so a
// single Ctrl+Z removes the whole batch. Outputs are grouped in a new Library
// folder (the existing folder tree; no new grouping mechanism) so an "Overlay
// these" chip can plot them together.

import { commonFolder } from "../groupOutputs";
import { moveToFolderViaWorkbooks } from "../../../store/collapsedWorkbookActions";
import { asOneEditStep } from "../../../store/undoStep";
import type { Dataset, DataStruct } from "../../../lib/types";
import { dataFingerprint } from "../../../lib/dataFingerprint";
import type { CommitSettings } from "../../../lib/committedOutput";
import { commitAnalysisOutput } from "../../../store/analysisOutputCommit";
import type { AppState } from "../../../store/useApp";

export const BASELINE_BATCH_PRODUCER = { id: "baseline-batch", label: "Baseline subtract (batch)", version: 1 } as const;

export interface BaselineSource {
  xKey: number | null;
  xLabel: string;
  yKey: number;
  yLabel: string;
}

/** `src` with `baseline` subtracted from channel `source.yKey` (non-finite
 *  samples and null baseline points are left untouched). */
export function subtractBaselineData(
  src: DataStruct,
  baseline: readonly (number | null)[],
  source: BaselineSource,
  method: string,
): DataStruct {
  const yKey = source.yKey;
  const values = src.values.map((row, i) => {
    const b = baseline[i];
    const next = [...row];
    if (Number.isFinite(row[yKey]) && b != null) next[yKey] = row[yKey] - b;
    return next;
  });
  return {
    ...src,
    values,
    metadata: {
      ...src.metadata,
      baseline_subtracted: method,
      baseline_source: {
        x_key: source.xKey,
        x_label: source.xLabel,
        y_key: source.yKey,
        y_label: source.yLabel,
      },
    },
  };
}

export const bgSubName = (name: string): string => `${name.replace(/\.[^.]+$/, "")} (bg-sub)`;

/** One batch output with the source it was computed from. */
export interface BaselineBatchItem {
  name: string;
  data: DataStruct;
  sourceId: string;
  /** `analysisDataFingerprint(source)` as read when the baseline was estimated. */
  computedOn: string;
  /** The inputs of the estimate (method knobs, channels): part of the commit key. */
  settings: CommitSettings;
}

/** Write every output as a new dataset inside a fresh folder, as ONE undo
 *  step, each through the shared commit contract (store/analysisOutputCommit.ts):
 *  linked to its source with the recorded inputs, out of date when its source
 *  changes, and a repeat of an identical output adds nothing. An output that is
 *  refused (its source changed while the batch ran) is reported, never skipped
 *  silently. Returns the ids of the outputs it wrote (in input order), the
 *  folder id and one reason per refusal. */
export function commitBaselineBatch(
  items: readonly BaselineBatchItem[],
  sources: readonly Dataset[],
  method: string,
  get: () => AppState,
): { ids: string[]; folderId: string | null; refused: string[] } {
  const refused: string[] = [];
  // Commit first and make the folder only when something new was written, so a
  // repeat click leaves no empty folder and no history entry behind.
  return asOneEditStep(get, `baseline ${method} on ${items.length} datasets`, () => {
    const ids: string[] = [];
    for (const item of items) {
      const outcome = commitAnalysisOutput({
        producer: BASELINE_BATCH_PRODUCER,
        sourceId: item.sourceId,
        computedOn: item.computedOn,
        settings: { ...item.settings, output: dataFingerprint(item.data) },
        output: () => ({ name: item.name, data: item.data }),
        quiet: true,
      });
      if (outcome.kind === "refused") refused.push(`${item.name}: ${outcome.reason}`);
      else if (outcome.kind === "created") ids.push(outcome.outputId);
    }
    if (!ids.length) return { ids, folderId: null, refused };
    const folderId = get().createFolder(commonFolder(get(), sources), `Baseline-subtracted (${method})`);
    moveToFolderViaWorkbooks(ids, folderId);
    return { ids, folderId, refused };
  });
}
