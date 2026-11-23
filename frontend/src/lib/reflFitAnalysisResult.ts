import type { AnalysisResult, AnalysisResultValue } from "./analysisResult";
import { INPUTS_PARAM, recordFingerprint } from "./resultInputsRecord";
import type { Dataset } from "./types";

interface CatalogRecord {
  id: string;
  seq: number;
  fittedAt: string;
  datasetIds: string[];
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Read only the identity and references needed by the catalog. The full fit
 * record remains owned and validated by reflFitRecord.ts when a user opens it. */
function catalogRecord(value: unknown): CatalogRecord | null {
  const raw = object(value);
  const request = object(raw?.request);
  const model = object(raw?.model);
  const result = object(raw?.result);
  if (raw?.version !== 1 || typeof raw.id !== "string" || !raw.id ||
      !request || !model || !result || !Array.isArray(request.parameters) ||
      !object(request.settings) || !Array.isArray(request.channels) || request.channels.length === 0 ||
      !Array.isArray(model.layers) || model.layers.length < 2 ||
      !Array.isArray(result.parameters) || !Array.isArray(result.free)) return null;
  const datasetIds: string[] = [];
  for (const item of request.channels) {
    const channel = object(item);
    if (!channel || typeof channel.datasetId !== "string" || !channel.datasetId) return null;
    datasetIds.push(channel.datasetId);
  }
  return {
    id: raw.id,
    seq: typeof raw.seq === "number" && Number.isInteger(raw.seq) && raw.seq > 0 ? raw.seq : 1,
    fittedAt: typeof raw.fittedAt === "string" ? raw.fittedAt : "",
    datasetIds,
  };
}

export const reflectivityFitResultId = (datasetId: string, recordId: string): string =>
  `analysis-refl-fit-${datasetId}-${recordId}`;

/** The producer of a fit's catalog entry. The worksheets "Add fit curves" and
 *  "Add uncertainty bands" write are separate results pointing at the same
 *  record (components/workshops/reflectivity/reflFitOutputsCommit.ts); only
 *  this producer is the catalog entry the migration and publish keep one of. */
export const REFL_FIT_PRODUCER_ID = "reflectivity-fit";

export const isReflFitCatalogEntry = (result: AnalysisResult): boolean =>
  result.producer.id === REFL_FIT_PRODUCER_ID && result.settingsRef?.field === "reflFits";

export function reflectivityFitAnalysisResult(
  value: unknown,
  datasets: readonly Dataset[],
  /** The C9 inputs as the fit read them (reflectivity/reflFitInputs.ts), given
   *  only by the publish right after the fit; a migration records none. */
  inputs?: AnalysisResultValue,
): AnalysisResult | null {
  const record = catalogRecord(value);
  if (!record) return null;
  const fingerprint = recordFingerprint("reflFits", value);
  const sourceIds = [...new Set(record.datasetIds)];
  const hostId = sourceIds[0];
  const host = datasets.find((dataset) => dataset.id === hostId);
  return {
    version: 1,
    id: reflectivityFitResultId(hostId, record.id),
    name: `Reflectivity fit #${record.seq} · ${host?.name || "data"}`,
    producer: { id: REFL_FIT_PRODUCER_ID, label: "Reflectivity Fit", version: 1 },
    sources: sourceIds.map((datasetId) => ({ datasetId, role: "input" as const })),
    outputs: [],
    // Points at the stored record (never a copy) and the record it was (lib/resultInputsRecord.ts).
    settingsRef: { datasetId: hostId, field: "reflFits", recordId: record.id, ...(fingerprint ? { fingerprint } : {}) },
    ...(inputs !== undefined ? { parameters: { [INPUTS_PARAM]: inputs } } : {}),
    // Scientific warnings stay in the live fit record and are shown by the
    // result workspace. The envelope does not duplicate that authority.
    warnings: [],
    createdAt: record.fittedAt,
  };
}

/** Add catalog entries for saved fits exactly once. The same record is stored
 * on every participating dataset, so record id — not array position — is the
 * deduplication key. Existing entries preserve user names and notes. */
export function migrateReflectivityFitAnalysisResults(
  datasets: readonly Dataset[],
  existing: readonly AnalysisResult[],
): AnalysisResult[] {
  const linked = new Set(existing.flatMap((result) =>
    isReflFitCatalogEntry(result) && result.settingsRef?.field === "reflFits"
      ? [reflectivityFitResultId(result.settingsRef.datasetId, result.settingsRef.recordId)]
      : [],
  ));
  const added: AnalysisResult[] = [];
  for (const dataset of datasets) {
    if (!Array.isArray(dataset.reflFits)) continue;
    for (const stored of dataset.reflFits) {
      const result = reflectivityFitAnalysisResult(stored, datasets);
      if (!result || linked.has(result.id)) continue;
      linked.add(result.id);
      added.push(result);
    }
  }
  return [...existing, ...added];
}
