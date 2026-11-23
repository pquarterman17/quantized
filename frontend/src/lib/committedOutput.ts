// The shared "commit derived output" contract (lane RL). Pure: the commit key
// and the AnalysisResult envelope a tool's "Add … as dataset" publishes with its
// output worksheet. The store side (one undo step, idempotency against the live
// project) is store/analysisOutputCommit.ts; the recalc side (stale marking per
// the project's recalc mode) is lib/committedOutputGraph.ts.
//
// The key is BY VALUE: producer + source id + the source's analysis-view
// fingerprint at compute time + the tool's settings (inputs AND the result
// digest the output encodes). A repeat click on the same computation finds the
// same key; any real change to the data, the controls or the fitted values is a
// new computation and commits normally.

import type { AnalysisResult, AnalysisResultProducer, AnalysisResultValue } from "./analysisResult";
import { ANALYSIS_RESULT_VERSION } from "./analysisResult";
import { COMMIT_KEY_PARAM, REOPEN_PARAM, isCommittedOutputResult } from "./committedOutputGraph";
import { dataFingerprint } from "./dataFingerprint";
import { INPUTS_PARAM, recordedInputs, type InputXSpec, type XWindow } from "./resultInputsRecord";
import type { Dataset } from "./types";

export type CommitSettings = Record<string, unknown>;

/** A settings value the envelope sanitizer keeps on reopen: non-finite numbers
 *  become null (the sanitizer would otherwise drop ALL parameters, and with
 *  them the commit key), undefined fields are omitted. */
export function toResultValue(value: unknown): AnalysisResultValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toResultValue);
  if (typeof value === "object") {
    const out: Record<string, AnalysisResultValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = toResultValue(item);
    }
    return out;
  }
  return null;
}

export function committedOutputKey(
  producerId: string, sourceId: string, sourceFingerprint: string, settings: CommitSettings,
): string {
  return JSON.stringify([producerId, sourceId, sourceFingerprint, toResultValue(settings)]);
}

/** The id of the CURRENT committed result for `key`: its output worksheet still
 *  exists and is not marked stale (in the session's `staleDatasets`, or on the
 *  envelope: an Undo of a replace restores a stale output's envelope marked).
 *  A result whose output was deleted, or that went stale, no longer blocks a
 *  new commit. */
export function findCommittedResultId(
  results: readonly AnalysisResult[],
  datasets: readonly Pick<Dataset, "id">[],
  staleDatasets: readonly string[],
  key: string | null,
): string | null {
  if (!key) return null;
  for (const result of results) {
    if (!isCommittedOutputResult(result) || result.parameters?.[COMMIT_KEY_PARAM] !== key || result.stale) continue;
    const output = result.outputs[0]!.datasetId;
    if (datasets.some((dataset) => dataset.id === output) && !staleDatasets.includes(output)) return result.id;
  }
  return null;
}

export function committedOutputResult(args: {
  id: string;
  producer: AnalysisResultProducer;
  source: Dataset;
  /** Further source worksheets of a multi-source output (a batch trend). */
  extraSources?: readonly Dataset[];
  output: Dataset;
  key: string;
  settings: CommitSettings;
  /** What "Open in <tool>" needs beyond the keyed settings (not keyed). */
  reopen?: CommitSettings;
  /** The X column the computation read (channel index; null = time axis). Omitted =
   *  unknown: NO X range is recorded (fail closed, acceptance C9). */
  xKey?: InputXSpec;
  /** The inclusive X window the tool read (an optional X range); recorded with the inputs. */
  xWindow?: XWindow;
  createdAt?: string;
}): AnalysisResult {
  const { id, producer, source, output, key, settings } = args;
  const extras = args.extraSources ?? [];
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `${producer.label} · ${source.name}${extras.length ? ` +${extras.length}` : ""}`,
    producer,
    sources: [source, ...extras].map((s) => ({ datasetId: s.id, role: "input" as const })),
    outputs: [{ datasetId: output.id, role: "linked-worksheet" }],
    parameters: {
      [COMMIT_KEY_PARAM]: key, settings: toResultValue(settings),
      // Criterion 9: the inputs as computed (channels + units, included rows, X range).
      [INPUTS_PARAM]: recordedInputs([source, ...extras], { xKey: args.xKey, ...(args.xWindow ? { xWindow: args.xWindow } : {}) }),
      ...(args.reopen ? { [REOPEN_PARAM]: toResultValue(args.reopen) } : {}),
    },
    tableRefs: [{ datasetId: output.id, label: output.name }],
    plotBindings: [{ datasetId: output.id, channels: output.data.labels.map((_, index) => index) }],
    warnings: [],
    createdAt: args.createdAt ?? new Date().toISOString(),
    // The same format the save-side stamp and the load-side scan compare.
    sourceFingerprint: [source, ...extras].map((s) => dataFingerprint(s.data)).join(":"),
  };
}
