// Reflectivity fit curves and DREAM bands as ONE multi-output result
// (result-lifecycle acceptance C13, audit rows 26/27; owner-approved
// recommendation 2026-11-23). "Add fit curves" writes one worksheet per
// channel model and per SLD profile, "Add uncertainty bands" one per R band
// and SLD band: several worksheets from ONE computation. They land with ONE
// AnalysisResult whose `outputs` lists every one of them (`outputs[0]` is the
// primary, each entry carries its `part`), so the recalc graph
// (lib/committedOutputGraph.ts, which already walks every output) marks EACH
// stale when a fitted source changes, in Auto and Manual mode, nothing in None,
// and never recomputes them (there is no recipe to replay: re-run the fit).
//
// The envelope POINTS at the fit's stored record (settingsRef + its
// fingerprint, lib/resultInputsRecord.ts); it never copies it. The commit key
// marks it a committed output: producer + host + record fingerprint + the
// record id (and, for bands, the run).
//
// Fail closed, but never falsely: a record whose fitted data HAS CHANGED since
// the fit (a source changed or went missing: reflFitInputs.ts `fitInputsState`)
// still adds the worksheets, but its result is born stale with the reason. One
// that merely CANNOT BE VERIFIED YET (a lazy source not loaded, a channel
// stored without a digest) is born neither stale nor fingerprinted: the load /
// lazy-install checks judge it later. Recalc mode "off" tracks nothing, so no
// stale marking at all. No stored record (a live fit whose datasets were
// deleted mid-fit): plain worksheets, nothing to point at. Re-adding after the
// previous worksheets were deleted replaces the orphaned same-key result.

import type { AnalysisResult, AnalysisResultProducer } from "../../../lib/analysisResult";
import { ANALYSIS_RESULT_VERSION } from "../../../lib/analysisResult";
import { committedOutputKey } from "../../../lib/committedOutput";
import { COMMIT_KEY_PARAM } from "../../../lib/committedOutputGraph";
import { rawSourceFingerprint } from "../../../lib/textFingerprint";
import { INPUTS_PARAM, recordFingerprint } from "../../../lib/resultInputsRecord";
import type { Dataset } from "../../../lib/types";
import { addDatasetsOneStep } from "../../../store/addDatasetsOneStep";
import { nextAnalysisResultId } from "../../../store/idSeq";
import { curveDatasetFor, type CurveDataset } from "./reflFitCurves";
import { fitInputsState } from "./reflFitInputs";
import { recordDatasetIds, type ReflFitRecord } from "./reflFitRecord";

export const REFL_CURVES_PRODUCER: AnalysisResultProducer = { id: "reflectivity-fit-curves", label: "Reflectivity fit curves", version: 1 };
export const REFL_BANDS_PRODUCER: AnalysisResultProducer = { id: "reflectivity-fit-bands", label: "Reflectivity uncertainty bands", version: 1 };

/** Why a result is born stale (shown in its diagnostics). */
export const REFL_OUTPUTS_NOT_CURRENT =
  "The fitted data changed, or a source worksheet is missing, since this fit: these worksheets are out of date. Run the fit again to replace them.";

/** The record as stored on its first source that holds it (the form a reader fingerprints). */
export function storedRecordValue(record: Pick<ReflFitRecord, "id" | "request">, datasets: readonly Dataset[]): unknown {
  for (const id of recordDatasetIds(record)) {
    const fits = datasets.find((dataset) => dataset.id === id)?.reflFits;
    const hit = Array.isArray(fits) ? fits.find((item) => !!item && typeof item === "object" && (item as { id?: unknown }).id === record.id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

export function reflFitOutputsResult(args: {
  id: string;
  producer: AnalysisResultProducer;
  record: ReflFitRecord;
  /** The record as stored (`storedRecordValue`). */
  stored: unknown;
  datasets: readonly Dataset[];
  outputs: readonly { dataset: Pick<Dataset, "id" | "name" | "data">; part: string }[];
  /** A band run's time (bands only). */
  ranAt?: string;
  createdAt?: string;
  /** False in recalc mode "off": nothing is tracked, so nothing is marked stale. Default true. */
  track?: boolean;
}): AnalysisResult | null {
  const { record, datasets, producer } = args;
  const fingerprint = recordFingerprint("reflFits", args.stored);
  if (!fingerprint || !args.outputs.length) return null;
  const sourceIds = recordDatasetIds(record);
  const hostId = sourceIds[0]!;
  const verdict = fitInputsState(record, datasets);
  const inputs = verdict.state === "current" ? verdict.inputs : undefined;
  const stale = verdict.state === "changed" && args.track !== false;
  const settings = { recordId: record.id, ...(args.ranAt !== undefined ? { ranAt: args.ranAt } : {}) };
  return {
    version: ANALYSIS_RESULT_VERSION,
    id: args.id,
    name: `${producer.label} · ${curveDatasetFor(record, datasets).base}`,
    producer,
    sources: sourceIds.map((datasetId) => ({ datasetId, role: "input" as const })),
    outputs: args.outputs.map(({ dataset, part }) => ({ datasetId: dataset.id, role: "linked-worksheet" as const, part })),
    settingsRef: { datasetId: hostId, field: "reflFits", recordId: record.id, fingerprint },
    parameters: {
      [COMMIT_KEY_PARAM]: committedOutputKey(producer.id, hostId, fingerprint, settings),
      settings,
      ...(inputs !== undefined ? { [INPUTS_PARAM]: inputs } : {}),
    },
    tableRefs: args.outputs.map(({ dataset }) => ({ datasetId: dataset.id, label: dataset.name })),
    plotBindings: args.outputs.map(({ dataset }) => ({ datasetId: dataset.id, channels: dataset.data.labels.map((_, index) => index) })),
    warnings: stale ? [REFL_OUTPUTS_NOT_CURRENT] : [],
    createdAt: args.createdAt ?? new Date().toISOString(),
    ...(verdict.state === "current"
      ? { sourceFingerprint: sourceIds.map((id) => rawSourceFingerprint(datasets.find((dataset) => dataset.id === id)!.data)).join(":") }
      : stale ? { stale: true as const } : {}),
  };
}

/** Add `items` (curves or bands of `record`) and their one result in ONE undo
 *  step; returns the new worksheet ids in input order. */
export function commitReflFitOutputs(
  label: string,
  producer: AnalysisResultProducer,
  record: ReflFitRecord | null,
  items: readonly CurveDataset[],
  ranAt?: string,
): string[] {
  const toDataset = (c: CurveDataset): Omit<Dataset, "id"> => ({ name: c.name, data: c.data, ...c.placement });
  return addDatasetsOneStep(label, items.map(toDataset), (ids, { get, set }) => {
    const { datasets, recalcMode } = get();
    // No stored record (a live fit whose datasets were deleted mid-fit): plain worksheets.
    const stored = record ? storedRecordValue(record, datasets) : undefined;
    if (!record || stored === undefined) return;
    const added = ids.map((id, index) => ({ dataset: datasets.find((d) => d.id === id)!, part: items[index]!.part }));
    if (added.some(({ dataset }) => !dataset)) return;
    const result = reflFitOutputsResult({
      id: nextAnalysisResultId(), producer, record, stored, datasets, outputs: added, ranAt, track: recalcMode !== "off",
    });
    if (!result) return;
    const key = result.parameters?.[COMMIT_KEY_PARAM];
    // A same-key result whose worksheets were all deleted is an orphan of an earlier add: replace it.
    const orphan = (r: AnalysisResult) => r.parameters?.[COMMIT_KEY_PARAM] === key &&
      r.outputs.every((ref) => !datasets.some((d) => d.id === ref.datasetId));
    set((s) => ({
      analysisResults: [...s.analysisResults.filter((r) => !orphan(r)), result],
      ...(result.stale ? { staleDatasets: [...s.staleDatasets, ...ids.filter((id) => !s.staleDatasets.includes(id))] } : {}),
    }));
  });
}
